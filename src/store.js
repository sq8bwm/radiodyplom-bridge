// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Trwała kolejka plikowa (crash-safe): każdy element to jeden plik JSON.
// Deduplikacja po kluczu (logid#rowid) przez zbiór "seen".
import {
  mkdirSync, readdirSync, readFileSync, writeFileSync,
  renameSync, unlinkSync, existsSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { log } from './log.js';
import { acquireLock, releaseLock } from './lock.js';
import { writeAtomic } from './atomic.js';

export class Store {
  constructor({ dir, failedDir, seenFile }) {
    this.dir = dir;
    this.failedDir = failedDir;
    this.seenFile = seenFile;
    this.seen = new Set();        // klucze obsłużone: wysłane ALBO trwale odrzucone
    this.pendingKeys = new Set(); // klucze aktualnie w kolejce
    this.skipped = 0;             // ile QSO pominięto jako już znane
    // Licznik REALNIE wysłanych. Osobny od `seen`, bo `seen` obejmuje też
    // trwałe odrzucenia — pokazywanie jego rozmiaru jako „wysłane" zawyżało
    // licznik przy każdym odrzuceniu i mówiło użytkownikowi, że QSO doszło.
    this.sentCount = 0;
    // Ile odrzuconych QSO użytkownik już zobaczył i potwierdził. Sygnalizacja
    // problemów wynika z RÓŻNICY między zawartością failed/ a tą liczbą —
    // nie z licznika w pamięci. Pierwsza wersja trzymała to w workerze
    // i przepadało przy restarcie, choć odrzucone QSO zostawały na dysku.
    this.ackedFailed = 0;
  }

  init() {
    mkdirSync(this.dir, { recursive: true });
    mkdirSync(this.failedDir, { recursive: true });
    this._acquireLock();
    // Wczytaj seen
    if (existsSync(this.seenFile)) {
      try {
        const data = JSON.parse(readFileSync(this.seenFile, 'utf8'));
        if (Array.isArray(data)) {
          // Format z wersji bez licznika. Przyjmujemy dotychczasową liczbę,
          // żeby nie wyzerować użytkownikowi statystyki przy aktualizacji.
          this.seen = new Set(data);
          this.sentCount = data.length;
        } else if (data && Array.isArray(data.seen)) {
          this.seen = new Set(data.seen);
          this.sentCount = Number.isFinite(data.sent) ? data.sent : data.seen.length;
          this.ackedFailed = Number.isFinite(data.ackedFailed) ? data.ackedFailed : 0;
        }
      } catch (err) {
        log.warn('Nie mogę wczytać seen.json, startuję z pustym', err.message);
      }
    }
    // Odbuduj pendingKeys z plików w kolejce
    for (const item of this.list()) this.pendingKeys.add(item.key);

    log.info('Kolejka zainicjowana', {
      pending: this.pendingKeys.size, seen: this.seen.size,
    });
  }

  /** Blokada katalogu danych – patrz lock.js. */
  _acquireLock() {
    this.lockFile = join(this.dir, '..', '.lock');
    acquireLock(
      this.lockFile,
      'Katalog danych',
      'Uruchomienie dwóch mostków na jednej kolejce grozi wysłaniem QSO pod złą stację. '
      + 'Zamknij tamtą instancję albo ustaw osobny dataDir.',
    );
  }

  release() {
    releaseLock(this.lockFile);
  }

  isKnown(key) {
    return this.seen.has(key) || this.pendingKeys.has(key);
  }

  _fileFor(item) {
    const safe = item.key.replace(/[^A-Za-z0-9_.#-]/g, '_');
    return join(this.dir, `${item.createdAt}-${safe}.json`);
  }

  _atomicWrite(path, obj) {
    // _file to pole runtime'owe – nie zapisujemy go do pliku.
    const body = obj && typeof obj === 'object' && !Array.isArray(obj)
      ? Object.fromEntries(Object.entries(obj).filter(([k]) => k !== '_file'))
      : obj;
    writeAtomic(path, JSON.stringify(body, null, 2));
  }

  /** Dodaje nowy element. Zwraca false, jeśli klucz już znany (dedup). */
  enqueue({ key, payload, meta }) {
    if (this.isKnown(key)) { this.skipped += 1; return false; }
    const item = {
      key,
      payload,
      meta: meta || {},
      attempts: 0,
      nextAt: 0,
      createdAt: Date.now(),
      lastError: null,
    };
    item._file = this._fileFor(item);
    this._atomicWrite(item._file, item);
    this.pendingKeys.add(key);
    return true;
  }

  /** Lista elementów oczekujących (posortowana wg createdAt). */
  list() {
    let files;
    try {
      files = readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
    const items = [];
    for (const f of files) {
      const full = join(this.dir, f);
      try {
        const item = JSON.parse(readFileSync(full, 'utf8'));
        item._file = full;
        items.push(item);
      } catch (err) {
        log.warn(`Uszkodzony element kolejki ${f}`, err.message);
      }
    }
    items.sort((a, b) => a.createdAt - b.createdAt);
    return items;
  }

  /** Liczniki dla UI – bez wczytywania całych elementów. */
  counts() {
    const count = (dir) => {
      try { return readdirSync(dir).filter((f) => f.endsWith('.json')).length; } catch { return 0; }
    };
    return {
      pending: count(this.dir), failed: count(this.failedDir),
      sent: this.sentCount, skipped: this.skipped,
    };
  }

  /** Elementy z katalogu failed/ (do podglądu i ponowienia z UI). */
  listFailed() {
    let files;
    try { files = readdirSync(this.failedDir).filter((f) => f.endsWith('.json')); } catch { return []; }
    const out = [];
    for (const f of files) {
      try {
        const item = JSON.parse(readFileSync(join(this.failedDir, f), 'utf8'));
        item._file = join(this.failedDir, f);
        out.push(item);
      } catch { /* pomiń uszkodzony */ }
    }
    return out;
  }

  update(item) {
    this._atomicWrite(item._file, item);
  }

  _markSeen(key) {
    this.seen.add(key);
    this._persistState();
  }

  _persistState() {
    this._atomicWrite(this.seenFile, {
      seen: [...this.seen],
      sent: this.sentCount,
      ackedFailed: this.ackedFailed,
    });
  }

  /**
   * Ile odrzuconych QSO czeka na uwagę użytkownika.
   * Liczone z zawartości failed/, więc przeżywa restart programu.
   */
  unackedFailed() {
    const failed = this.counts().failed;
    // Poziom potwierdzenia nie może zostać wyżej niż stan faktyczny. Inaczej
    // po przywróceniu odrzuconych („Ponów odrzucone") albo po ręcznym
    // opróżnieniu failed/ NOWE odrzucenie byłoby przemilczane — a to najgorszy
    // możliwy błąd w czymś, co ma ostrzegać.
    if (this.ackedFailed > failed) {
      this.ackedFailed = failed;
      this._persistState();
    }
    return Math.max(0, failed - this.ackedFailed);
  }

  /**
   * Potwierdza obejrzenie odrzuconych. Nie usuwa ich — zostają w failed/
   * i dalej da się je ponowić.
   * @returns {number} ile było niepotwierdzonych
   */
  ackFailed() {
    const had = this.unackedFailed();
    this.ackedFailed = this.counts().failed;
    this._persistState();
    return had;
  }

  /**
   * Trwale usuwa odrzucone QSO z failed/. Do użycia, gdy są to łączności
   * błędne i nie ma czego ratować — na przykład testowe albo z pomyłkowym
   * znakiem.
   *
   * Każde usunięte QSO trafia do LOGU. Ciche kasowanie łączności byłoby wbrew
   * całej zasadzie tego programu: jeśli QSO ma zniknąć, musi po nim zostać
   * ślad w pliku logu.
   *
   * @returns {{removed:number, calls:string[]}}
   */
  discardFailed() {
    const items = this.listFailed();
    const calls = [];
    let removed = 0;
    for (const item of items) {
      const call = item.payload?.callsign || '?';
      const station = item.payload?.station_callsign || '?';
      try {
        unlinkSync(item._file);
        removed += 1;
        calls.push(call);
        log.warn(`USUNIĘTE odrzucone QSO: ${call} → ${station}`, {
          code: item.lastErrorCode || null, error: item.lastError || null, key: item.key,
        });
      } catch (err) {
        log.error(`Nie mogę usunąć ${item._file}: ${err.message}`);
      }
    }
    if (removed) {
      this.ackedFailed = this.counts().failed;
      this._persistState();
      log.warn(`Usunięto trwale ${removed} odrzuconych QSO`, { calls });
    }
    return { removed, calls };
  }

  /**
   * Uwalnia klucze z deduplikacji, żeby dało się te QSO wysłać jeszcze raz.
   * Potrzebne przy ręcznym ponawianiu odrzuconych: serwer odrzucił je „na
   * zawsze", ale po poprawieniu uprawnień w Managerze przestaje to być prawdą,
   * a bez uwolnienia klucza kolejka by ich nie przyjęła.
   * @returns {number} ile kluczy zwolniono
   */
  forgetKeys(keys) {
    let n = 0;
    for (const k of keys) if (this.seen.delete(k)) n += 1;
    if (n) this._persistState();
    return n;
  }

  /** Sukces: usuń z kolejki, zapisz klucz jako obsłużony. */
  complete(item) {
    this.sentCount += 1;
    this._markSeen(item.key);
    this.pendingKeys.delete(item.key);
    try { unlinkSync(item._file); } catch { /* już usunięty */ }
  }

  /**
   * Niepowodzenie: przenieś do failed/.
   * @param {boolean} markSeen  true = serwer odrzucił dane (nie ponawiamy nigdy);
   *                            false = wyczerpane próby z powodu awarii sieci –
   *                            klucz zostaje wolny, żeby dało się przywrócić (npm run requeue).
   */
  fail(item, markSeen = true) {
    if (markSeen) this._markSeen(item.key);
    this.pendingKeys.delete(item.key);
    // basename(), nie split('/') – na Windows separatorem jest '\\'.
    const base = basename(item._file);
    const dest = join(this.failedDir, base);
    try { this._atomicWrite(dest, item); unlinkSync(item._file); } catch (err) {
      log.warn('Nie mogę przenieść elementu do failed/', err.message);
    }
  }
}
