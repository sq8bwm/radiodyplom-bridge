// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Lokalna powierzchnia stanu dla UI (Electron albo przeglądarka).
//
// Świadome decyzje:
//  - Bind wyłącznie na 127.0.0.1. To interfejs sterujący wysyłką QSO na Twoim
//    PIN-ie; wystawienie go na sieć dałoby obcym kontrolę nad Twoim logiem.
//  - PIN-y NIGDY nie opuszczają procesu — zawsze zamaskowane.
//  - Zero zależności: node:http wystarcza.
import http from 'node:http';
import { log, recentLog } from './log.js';
import { readRecords, parseDay } from './journal.js';
import { aggregate, filterRecords, filterOptions } from './stats.js';

/** Maskuje PIN do postaci bezpiecznej w UI: "ABCD-****". */
export function maskPin(pin) {
  if (!pin) return null;
  const s = String(pin);
  const parts = s.split('-');
  if (parts.length >= 2) return `${parts[0]}-${'*'.repeat(Math.max(4, parts[1].length))}`;
  return s.length <= 4 ? '****' : `${s.slice(0, 2)}****`;
}

/**
 * Wyliczenie stanu ogólnego. Jedno źródło prawdy dla ikony w zasobniku
 * i dla interfejsu — wcześniej każde liczyło po swojemu i wersje się rozjechały.
 */
export function computeState({ paused, online, failed, pingOk }) {
  if (paused) return { state: 'warn', reason: 'Wysyłka wstrzymana' };
  if (pingOk === false || online === false) {
    return { state: 'error', reason: 'Brak łączności z radiodyplom' };
  }
  if (failed > 0) return { state: 'warn', reason: `Odrzucone QSO: ${failed}` };
  return { state: 'ok', reason: 'Działa' };
}

export class StatusApi {
  constructor({ cfg, store, listener, worker, pkg, getPing, getProfile, requeue, getConfig, saveConfig,
    getPendingRestart, getLogFile, getAccountChecks, checkConfig, getUpdate }) {
    this.cfg = cfg;
    this.store = store;
    this.listener = listener;
    this.worker = worker;
    this.pkg = pkg || {};
    this.getPing = getPing;
    this.getProfile = getProfile;
    this.getPendingRestart = getPendingRestart;
    this.getLogFile = getLogFile;
    this.requeue = requeue;
    this.getConfig = getConfig;
    this.saveConfig = saveConfig;
    this.getAccountChecks = getAccountChecks;
    this.checkConfig = checkConfig;
    this.getUpdate = getUpdate;
    this.server = null;
    this.startedAt = Date.now();
  }

  status() {
    const ping = this.getPing ? this.getPing() : null;
    const counts = this.store.counts();
    const st = this.listener.stats || {};
    const nieodczytane = (st.unknown ?? 0) + (st.invalid ?? 0) + (st.skipped ?? 0);
    // Ocena celów po znaku stacji: UI dokłada ją do właściwego wiersza reguły.
    const checks = new Map(
      (this.getAccountChecks ? this.getAccountChecks() : [])
        .map((c) => [c.station, c]),
    );

    const { state, reason } = computeState({
      paused: this.worker.paused,
      online: this.worker.online,
      failed: counts.failed,
      pingOk: ping ? ping.ok : null,
    });

    return {
      state,
      stateReason: reason,
      // Ustawienia zapisane, ale jeszcze nieobowiązujące (czekają na restart).
      pendingRestart: this.getPendingRestart ? this.getPendingRestart() : [],       // tekst pomocniczy; UI tłumaczy po `state`
      app: this.pkg.name || 'radiodyplom-bridge',
      version: this.pkg.version || null,
      // Dane do zakładki „O programie". Źródłem jest package.json, żeby nie
      // trzymać ich drugi raz na sztywno w interfejsie i nie rozjechać.
      // Adres e-mail autora świadomie POMIJAMY – w oknie nie jest potrzebny.
      author: typeof this.pkg.author === 'string'
        ? this.pkg.author
        : (this.pkg.author?.name || null),
      license: this.pkg.license || null,
      repository: this.pkg.repository?.url || this.pkg.repository || null,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),

      // Nowsze wydanie — sama informacja, program NIE aktualizuje się sam.
      // `null` = nie sprawdzono albo sprawdzanie wyłączone w konfiguracji.
      update: (() => {
        const u = this.getUpdate ? this.getUpdate() : null;
        if (!u || !u.ok) return null;
        return { available: !!u.newer, latest: u.latest, url: u.url, checkedAt: u.checkedAt };
      })(),

      // Liczby „w tej sesji" wystawione OSOBNO i nazwane wprost.
      //
      // Po co: karta „wysłane" bierze licznik trwały (przeżywa restart i liczy
      // kopie fan-outu), a „odebrane z loggera" — licznik procesu. Zestawione
      // w jednym rzędzie sugerowały ten sam przedział czasu i tę samą
      // jednostkę; realnie pokazywały 1119 przy 191. Wyliczenie różnicy
      // w oknie skończyłoby się dwiema wersjami tej samej arytmetyki.
      session: {
        since: new Date(this.startedAt).toISOString(),
        qso: st.accepted ?? 0,               // QSO przyjęte z loggerów
        copies: this.worker.counters?.sent ?? 0,  // kopie faktycznie wysłane
        dryRun: this.worker.counters?.dryRun ?? 0,   // przejścia próbne tej sesji
        duplicates: this.worker.counters?.duplicates ?? 0,
        received: st.received ?? 0,          // wszystkie datagramy
        notDecoded: nieodczytane,            // datagramy, z których nie wyszło QSO
      },

      listener: {
        host: this.listener.host,
        port: this.listener.port,
        multicastGroups: this.listener.multicastGroups,
        localOnly: this.listener.host === '127.0.0.1',
        stats: this.listener.stats,
        // Rozbicie tego, co przyszło, ale QSO z tego nie powstało. Bez tego
        // różnica między „odebrane" a „źródła" nie była widoczna NIGDZIE
        // w oknie, a w logu siedziała na poziomie DEBUG.
        notDecoded: {
          total: nieodczytane,
          unknown: st.unknown ?? 0,   // żaden dekoder nie rozpoznał formatu
          invalid: st.invalid ?? 0,   // rozpoznany, ale bez wymaganych pól
          skipped: st.skipped ?? 0,   // pominięty świadomie (np. edycja QSO)
        },
      },

      radiodyplom: {
        apiUrl: this.cfg.radiodyplom.apiUrl,
        pin: maskPin(this.cfg.radiodyplom.pin),
        // Profil z ostatniego udanego PING-a – przy awarii łączności
        // nadal chcemy wiedzieć, czyim PIN-em pracujemy.
        profile: ping?.operator || (this.getProfile ? this.getProfile() : null),
        pingOk: ping ? ping.ok : null,
        pingError: ping && !ping.ok ? ping.error : null,
        dryRun: !!this.cfg.radiodyplom.dryRun,
        pinMissing: !!this.cfg._pinMissing,
        // Opis konta z PING-a. `stations: null` znaczy „serwis nie podał"
        // (starsza wersja API), a `[]` — „konto nie ma ani jednej stacji".
        account: ping?.ok ? {
          stations: ping.stations ?? null,
          activeActions: ping.activeActions ?? null,
          pinExpires: ping.pinExpires ?? null,
          apiEnabled: ping.apiEnabled ?? null,
        } : null,
      },

      forward: {
        operations: this.cfg.forward.operations,
        targets: (this.cfg.forward.targets || []).map((t) => {
          const c = checks.get(String(t.station_callsign || '').toUpperCase());
          return {
            station_callsign: t.station_callsign,
            operator: t.operator || null,
            pin: t.pin ? maskPin(t.pin) : null,
            enabled: t.enabled !== false,
            // Znaku operatora cudzego konta NIE podajemy dalej niż to potrzebne
            // do komunikatu; listy stacji cudzych kont nie podajemy wcale.
            check: c ? { state: c.state, blocking: c.blocking, operator: c.operator } : null,
          };
        }),
      },

      queue: {
        // Liczniki (pełne) i listy (przycięte) muszą mieć różne nazwy,
        // inaczej UI przy >50 elementach pokazałoby zaniżoną liczbę.
        ...counts,
        paused: this.worker.paused,
        online: this.worker.online,
        counters: this.worker.counters,
        pendingItems: this.store.list().slice(0, 50).map((i) => ({
          callsign: i.payload.callsign,
          station: i.payload.station_callsign,
          operator: i.payload.operator || null,
          attempts: i.attempts,
          nextAt: i.nextAt || null,
          lastError: i.lastError,
          code: i.lastErrorCode || null,
        })),
        failedItems: this.store.listFailed().slice(0, 50).map((i) => ({
          callsign: i.payload.callsign,
          station: i.payload.station_callsign,
          operator: i.payload.operator || null,
          attempts: i.attempts,
          lastError: i.lastError,
          code: i.lastErrorCode || null,
        })),
      },

      logFile: this.getLogFile ? this.getLogFile() : null,
      lastSent: this.worker.lastSent,
      lastError: this.worker.lastError,
      // Lista ostatnich zdarzeń; ile ich pokazać, decyduje konfiguracja.
      recentEvents: this.worker.recentEvents(this.cfg.ui?.recentEvents ?? 20),
      recentEventsMax: this.cfg.ui?.recentEvents ?? 20,
      // Sygnalizacja problemów. Liczona z zawartości failed/, nie z licznika
      // w pamięci — dzięki temu przeżywa restart programu, a to był cały sens:
      // QSO bywa odrzucane, gdy nikt nie patrzy.
      problems: (() => {
        const count = this.store.unackedFailed();
        if (!count) return { count: 0, last: null };
        const items = this.store.listFailed();
        const newest = items[items.length - 1];
        return {
          count,
          last: newest ? {
            callsign: newest.payload?.callsign || null,
            station: newest.payload?.station_callsign || null,
            code: newest.lastErrorCode || null,
            error: newest.lastError || null,
          } : null,
        };
      })(),
    };
  }

  _handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const send = (code, body) => {
      const json = JSON.stringify(body, null, 2);
      res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(json);
    };

    try {
      if (req.method === 'GET' && url.pathname === '/api/status') {
        return send(200, this.status());
      }
      if (req.method === 'GET' && url.pathname === '/api/log') {
        const n = Number(url.searchParams.get('n')) || 50;
        return send(200, { entries: recentLog(n) });
      }
      if (req.method === 'POST' && url.pathname === '/api/pause') {
        this.worker.pause();
        return send(200, { ok: true, paused: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/resume') {
        this.worker.resume();
        return send(200, { ok: true, paused: false });
      }
      if (req.method === 'POST' && url.pathname === '/api/problems/ack') {
        return send(200, { ok: true, cleared: this.store.ackFailed() });
      }
      if (req.method === 'POST' && url.pathname === '/api/failed/discard') {
        const r = this.store.discardFailed();
        return send(200, { ok: true, ...r });
      }
      if (req.method === 'POST' && url.pathname === '/api/requeue') {
        const n = this.requeue ? this.requeue() : 0;
        return send(200, { ok: true, restored: n });
      }
      if (req.method === 'GET' && url.pathname === '/api/stats') {
        // Liczymy przy odpytaniu — patrz src/stats.js. Zakres podaje się
        // datami QSO (RRRR-MM-DD), a nie czasem wysłania: dla aktywatora
        // liczy się dzień łączności, nie moment, w którym mostek ją dosłał.
        const from = parseDay(url.searchParams.get('from'));
        const to = parseDay(url.searchParams.get('to'));
        const dir = this.cfg.queue?.journalDir;
        const wszystkie = readRecords(dir, { from, to });

        // Listy wyboru z wpisów NIEZAWĘŻONYCH — inaczej po wybraniu operatora
        // nie dałoby się już wrócić do pozostałych.
        const options = filterOptions(wszystkie);
        // Ze żądania przyjmujemy tylko wartości, które w danych naprawdę są.
        const wybor = (nazwa, dozwolone) => {
          const v = String(url.searchParams.get(nazwa) || '').trim().toUpperCase();
          return v && dozwolone.includes(v) ? v : null;
        };
        const filters = {
          operator: wybor('operator', options.operators),
          station: wybor('station', options.stations),
        };
        const wynik = aggregate(filterRecords(wszystkie, filters));

        // Nazwy akcji bierzemy z PING-a, żeby w oknie nie stały same numery.
        // Serwis podaje tylko akcje AKTYWNE, więc dla starszych zostaje numer.
        const p = this.getPing ? this.getPing() : null;
        const nazwy = new Map((p?.activeActions || []).map((a) => [String(a.id), a.name]));
        wynik.perAction = wynik.perAction.map((x) => ({ ...x, name: nazwy.get(x.key) || null }));

        return send(200, { ok: true, from, to, filters, options, journalDir: dir, ...wynik });
      }
      if (req.method === 'GET' && url.pathname === '/api/config') {
        if (!this.getConfig) return send(501, { error: 'Edycja konfiguracji niedostępna' });
        return send(200, this.getConfig());
      }
      if (req.method === 'POST' && url.pathname === '/api/config/check') {
        if (!this.checkConfig) return send(501, { error: 'Sprawdzanie niedostępne' });
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
        req.on('end', () => {
          // Sprawdzanie NIGDY nie może zablokować zapisu: przy błędzie
          // oddajemy pustą listę ocen, a nie piątkę.
          Promise.resolve()
            .then(() => this.checkConfig(JSON.parse(body || '{}')))
            .then((checksList) => send(200, { ok: true, checks: checksList || [] }))
            .catch((err) => send(200, { ok: false, error: err.message, checks: [] }));
        });
        return undefined;
      }
      if (req.method === 'POST' && url.pathname === '/api/config') {
        if (!this.saveConfig) return send(501, { error: 'Edycja konfiguracji niedostępna' });
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
        req.on('end', () => {
          try {
            const result = this.saveConfig(JSON.parse(body || '{}'));
            send(200, result);
          } catch (err) {
            send(400, { error: err.message });
          }
        });
        return undefined;
      }
      return send(404, { error: 'Nieznany endpoint' });
    } catch (err) {
      log.error('Błąd API stanu', err.message);
      return send(500, { error: err.message });
    }
  }

  start() {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => this._handle(req, res));
      this.server.on('error', (err) => {
        log.warn(`API stanu niedostępne (${err.message}) – daemon działa dalej`);
        resolve(false);
      });
      // Zawsze 127.0.0.1, niezależnie od konfiguracji – patrz komentarz na górze.
      this.server.listen(this.cfg.api.port, '127.0.0.1', () => {
        log.info(`API stanu na http://127.0.0.1:${this.cfg.api.port}/api/status`);
        resolve(true);
      });
    });
  }

  stop() {
    if (this.server) {
      try { this.server.close(); } catch { /* już zamknięty */ }
      this.server = null;
    }
  }
}
