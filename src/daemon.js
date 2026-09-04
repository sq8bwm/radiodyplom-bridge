// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Rdzeń jako komponent osadzalny.
//
// src/index.js uruchamia go jako proces (tryb headless), a Electron osadza
// w swoim procesie głównym. Dzięki temu logika żyje w jednym miejscu,
// a UI jest tylko klientem — nigdy odwrotnie.
import { Store } from './store.js';
import { RadiodyplomClient } from './radiodyplom.js';
import { LoggerListener } from './udp.js';
import { Worker } from './worker.js';
import { StatusApi } from './httpapi.js';
import { requeueFailed } from './requeue.js';
import { distinctPins, verifyTargets, blockingTargets } from './accounts.js';
import { editableConfig, applyConfig, mergeTargets, mergeMainPin } from './configedit.js';
import { log, setLevel, recentLog } from './log.js';
import { enableFileLog, closeFileLog, logFilePath } from './logfile.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

function readPkg() {
  try {
    const p = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Uruchamia rdzeń. Nie rzuca przy problemach z siecią — QSO mają być
 * przyjmowane i buforowane nawet gdy API radiodyplom jest niedostępne.
 *
 * @param {object} cfg  wynik loadConfig()
 * @param {{startHttpApi?:boolean}} opts
 */
export async function startDaemon(cfg, opts = {}) {
  const { startHttpApi = true } = opts;
  setLevel(cfg.logLevel || 'info');

  // Log do pliku obok danych kolejki — tam, gdzie użytkownik ma prawo zapisu.
  if (cfg.logFile?.enabled !== false) {
    const dir = cfg.logFile?.dir || dirname(cfg.queue.seenFile);
    const p = enableFileLog({
      dir,
      maxBytes: cfg.logFile?.maxBytes,
      keep: cfg.logFile?.keep,
    });
    log.info(`Log zapisywany do pliku: ${p}`);
  }

  const store = new Store(cfg.queue);
  store.init();

  const client = new RadiodyplomClient(cfg.radiodyplom);

  const worker = new Worker({
    store, client, queue: cfg.queue, rateLimit: cfg.rateLimit,
  });

  const listener = new LoggerListener({
    host: cfg.udp.host,
    port: cfg.udp.port,
    multicastGroups: cfg.udp.multicastGroups,
    operations: cfg.forward.operations,
    pin: cfg.radiodyplom.pin,
    targets: cfg.forward.targets,
    onQSO: (item) => {
      const added = store.enqueue(item);
      if (added) {
        log.info(`Nowe QSO [${item.meta.source}]: ${item.payload.callsign} → ${item.payload.station_callsign}`, {
          band: item.payload.band, mode: item.payload.mode, operator: item.payload.operator,
        });
      } else {
        // NIE debug: pominięta kopia znikała bez śladu, przez co realnie
        // zgubione QSO wyglądało jak „nic nie przyszło". Musi być widoczne.
        log.info(
          `QSO ${item.payload.callsign} → ${item.payload.station_callsign} POMINIĘTE `
          + '(już wysłane wcześniej)',
          { key: item.key },
        );
      }
    },
  });

  // Socket UDP bindujemy PRZED sprawdzeniem klucza. PING potrafi trwać kilka sekund,
  // a UDP nie ponawia — QSO wysłane w tym oknie przepadłoby bezpowrotnie.
  await listener.start();
  worker.start();

  const handle = {
    cfg, store, client, worker, listener,
    api: null,
    lastPing: null,
    profile: null,
    // Opis kont (PIN → wynik PING-a). TYLKO w pamięci: to informacje
    // o cudzych kontach, potrzebne wyłącznie do ostrzeżenia w oknie.
    accounts: new Map(),
    pendingRestart: new Set(),  // ustawienia czekające na restart   // ostatni ZNANY profil – nie gubimy go przy awarii łączności
    pause: () => worker.pause(),
    resume: () => worker.resume(),
    requeue: () => requeueFailed(store).restored,
    ackProblems: () => store.ackFailed(),
    discardFailed: () => store.discardFailed(),
    /** Natychmiastowe sprawdzenie klucza (np. zaraz po jego zmianie w UI). */
    async refreshPing() {
      handle.lastPing = await client.ping();
      if (handle.lastPing.ok) handle.profile = handle.lastPing.operator;
      if (cfg.radiodyplom.pin) handle.accounts.set(cfg.radiodyplom.pin, handle.lastPing);
      return handle.lastPing;
    },
    /**
     * Odpytuje konta wszystkich PIN-ów z konfiguracji.
     *
     * Wołane na starcie i po zapisie konfiguracji, NIE w pętli co minutę:
     * cudze konta odpytywalibyśmy wtedy bez powodu, a nie wiem, czy PING
     * wchodzi w limit tempa razem z zapisami QSO.
     *
     * Nigdy nie rzuca. Brak odpowiedzi to „nie wiem", a nie usterka
     * konfiguracji — i pod żadnym pozorem nie wstrzymuje wysyłki QSO.
     */
    async refreshAccounts() {
      for (const { pin, main } of distinctPins(cfg)) {
        // Konto główne mamy już z cyklicznego PING-a — nie pytamy dwa razy.
        if (main && handle.lastPing) {
          handle.accounts.set(pin, handle.lastPing);
          continue;
        }
        try {
          handle.accounts.set(pin, await client.ping(pin));
        } catch (err) {
          handle.accounts.set(pin, { ok: false, error: err.message });
        }
      }
      // Klucze kont, których już nie ma w konfiguracji, przestają nas dotyczyć.
      const aktualne = new Set(distinctPins(cfg).map((p) => p.pin));
      for (const pin of [...handle.accounts.keys()]) {
        if (!aktualne.has(pin)) handle.accounts.delete(pin);
      }
      return handle.accountChecks();
    },
    /**
     * Ocena celów z konfiguracji NIEZAPISANEJ, wprost z okna.
     *
     * Po co osobno: użytkownik ma prawo dowiedzieć się o braku uprawnień
     * PRZED zapisem, a nowy PIN celu wpisany w okno nie jest jeszcze
     * w konfiguracji — więc żadne dotychczasowe dane go nie opisują.
     * Odpytujemy tylko PIN-y, których jeszcze nie znamy.
     */
    async checkConfig(patch) {
      const targets = Array.isArray(patch?.forward?.targets)
        ? mergeTargets(patch.forward.targets, cfg.forward.targets || [])
        : (cfg.forward.targets || []);
      const mainPin = mergeMainPin(patch?.radiodyplom?.pin, cfg.radiodyplom.pin);

      for (const { pin } of distinctPins({ radiodyplom: { pin: mainPin }, forward: { targets } })) {
        if (handle.accounts.has(pin)) continue;
        try {
          handle.accounts.set(pin, await client.ping(pin));
        } catch (err) {
          handle.accounts.set(pin, { ok: false, error: err.message });
        }
      }
      return verifyTargets({ targets, mainPin, accounts: handle.accounts });
    },
    /** Ocena każdego celu wobec uprawnień jego konta. */
    accountChecks() {
      return verifyTargets({
        targets: cfg.forward.targets || [],
        mainPin: cfg.radiodyplom.pin || null,
        accounts: handle.accounts,
      });
    },
    status: () => handle.api.status(),
    getConfig: () => editableConfig(cfg),
    saveConfig: (patch) => applyConfig(handle, patch),
    log: (n) => recentLog(n),
    logFilePath: () => logFilePath(),
    stop() {
      listener.stop();
      worker.stop();
      if (handle.api) handle.api.stop();
      if (handle.pingTimer) clearInterval(handle.pingTimer);
      store.release();
    },
  };

  // StatusApi buduje obiekt stanu; serwer HTTP jest opcjonalny (Electron go nie potrzebuje).
  handle.api = new StatusApi({
    cfg, store, listener, worker,
    pkg: readPkg(),
    getPing: () => handle.lastPing,
    getProfile: () => handle.profile,
    getAccountChecks: () => handle.accountChecks(),
    checkConfig: (patch) => handle.checkConfig(patch),
    getPendingRestart: () => [...(handle.pendingRestart || [])],
    getLogFile: () => logFilePath(),
    requeue: handle.requeue,
    getConfig: () => editableConfig(cfg),
    saveConfig: (patch) => applyConfig(handle, patch),
  });
  if (startHttpApi && cfg.api?.enabled !== false) await handle.api.start();

  // PING – informacyjny, nigdy nie blokuje.
  handle.lastPing = await client.ping();
  if (handle.lastPing.ok) handle.profile = handle.lastPing.operator;
  if (handle.lastPing.ok) {
    log.info(`API radiodyplom OK, PIN należy do profilu: ${handle.lastPing.operator}`);
  } else {
    log.warn(`PING nieudany: ${handle.lastPing.error} – działam dalej, kolejka buforuje`);
  }

  // Cykliczne odświeżanie PING-a. Bez tego „brak łączności" byłby znany wyłącznie
  // ze startu — przy pustej kolejce nic by go nie ujawniło.
  const pingEveryMs = cfg.radiodyplom.pingIntervalMs ?? 60000;
  handle.pingTimer = setInterval(async () => {
    const before = handle.lastPing?.ok;
    handle.lastPing = await client.ping();
    if (handle.lastPing.ok) handle.profile = handle.lastPing.operator;
    // Ten sam request niesie już listę stacji i akcji, więc opis konta
    // głównego odświeżamy za darmo. Cudzych kont tu NIE ruszamy.
    if (cfg.radiodyplom.pin) handle.accounts.set(cfg.radiodyplom.pin, handle.lastPing);
    if (before !== handle.lastPing.ok) {
      if (handle.lastPing.ok) log.info('Łączność z API przywrócona');
      else log.warn(`Utracono łączność z API: ${handle.lastPing.error}`);
    }
  }, pingEveryMs);
  handle.pingTimer.unref?.();

  // Sprawdzenie celów wobec uprawnień kont.
  //
  // Wcześniej stała tu heurystyka: „znak celu inny niż znak profilu = ostrzeż".
  // Zgadywała, bo API nie podawało listy stacji — hałasowała przy każdej
  // poprawnej konfiguracji z kilkoma stacjami i milczała przy złym PIN-ie celu.
  // Serwis oddaje teraz `stations` i `activeActions`, więc sprawdzamy fakty.
  await handle.refreshAccounts().then((checks) => {
    for (const c of checks) {
      if (!c.enabled || !c.blocking) continue;
      const czyje = c.pinSource === 'own' ? `PIN celu${c.operator ? ` (${c.operator})` : ''}`
        : `PIN główny${c.operator ? ` (${c.operator})` : ''}`;
      if (c.state === 'missing-station') {
        log.warn(`Cel ${c.station}: konto tego celu nie ma tego znaku na liście stacji `
          + `(${czyje}). Te kopie wrócą jako NOT_SAVED, dopóki nie dopiszesz stacji `
          + 'w Managerze na radiodyplom.pl.');
      } else if (c.state === 'bad-pin') {
        log.warn(`Cel ${c.station}: serwis odrzucił PIN tego celu. Kopie nie pójdą.`);
      } else if (c.state === 'api-disabled') {
        log.warn(`Cel ${c.station}: konto ma wyłączone API. Kopie nie pójdą.`);
      } else if (c.state === 'no-pin') {
        log.warn(`Cel ${c.station}: brak PIN-u — ani przy celu, ani głównego.`);
      }
    }
    const brak = blockingTargets(checks).length;
    if (brak === 0 && checks.length) log.info(`Cele fan-outu sprawdzone: ${checks.length}, bez zastrzeżeń`);
  }).catch((err) => {
    // Sprawdzanie jest wygodą, nie warunkiem pracy mostka.
    log.debug(`Nie udało się sprawdzić kont: ${err.message}`);
  });

  return handle;
}
