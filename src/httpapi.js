// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Lokalna powierzchnia stanu dla UI (Electron albo przeglądarka).
//
// Świadome decyzje:
//  - Domyślnie bind na 127.0.0.1. Nasłuch w sieci jest możliwy od 0.1.15, ale
//    WYMAGA hasła i TLS-a jednocześnie — patrz src/apiauth.js. To interfejs
//    sterujący wysyłką QSO na Twoim PIN-ie, więc każdy brak ochrony kończy się
//    pozostaniem na localhoście, nigdy otwartym portem.
//  - PIN-y NIGDY nie opuszczają procesu — zawsze zamaskowane.
//  - Zero zależności: node:http i node:https wystarczają.
import http from 'node:http';
import https from 'node:https';
import { log, recentLog } from './log.js';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRecords, parseDay } from './journal.js';
import { aggregate, filterRecords, filterOptions } from './stats.js';
import { summarizeTargets } from './fanout.js';
import {
  Sesje, Blokada, sprawdzHaslo, hasloUstawione, odczytajCiastko,
  ciastkoSesji, ciastkoWygaszone, trybApi, odciskCertyfikatu, adresyLokalne,
} from './apiauth.js';

/**
 * Maskuje PIN do postaci bezpiecznej także PUBLICZNIE: "AB**-****".
 *
 * Jawne zostają DWA pierwsze znaki — tyle wystarcza, żeby rozpoznać, którym
 * PIN-em się pracuje, gdy ma się ich kilka.
 *
 * Wcześniej jawny był cały pierwszy segment ("ABCD-****"). Na własnym ekranie
 * to bez znaczenia, ale zrzuty ekranu trafiają do zgłoszeń błędów i do
 * dokumentacji — a tam cztery znaki sekretu zostają na zawsze. Złapane
 * 2026-09-07 przy robieniu zrzutów do README: maska prawdziwego PIN-u
 * ujawniała jego pierwszy segment, który nie był znakiem wywoławczym.
 *
 * Liczba gwiazdek jest STAŁA — długość PIN-u to też informacja.
 */
export function maskPin(pin) {
  if (!pin) return null;
  const s = String(pin).trim();
  if (!s) return null;
  // Przy PIN-ie krótkim niż 5 znaków dwa jawne to już połowa sekretu.
  if (s.length <= 4) return '****';
  return s.includes('-') ? `${s.slice(0, 2)}**-****` : `${s.slice(0, 2)}****`;
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

// Pliki interfejsu oddawane po HTTP.
//
// Świadomie LISTA DOZWOLONYCH, a nie mapowanie ścieżki z żądania na dysk:
// przy mapowaniu każda literówka w sprawdzaniu `..` kończy się oddaniem
// czegokolwiek z systemu plików. Tu nie ma czego przeoczyć — nazwa spoza
// tej listy nie istnieje.
const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui');
const PLIKI_UI = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/renderer.js', ['renderer.js', 'text/javascript; charset=utf-8']],
  ['/strings.js', ['strings.js', 'text/javascript; charset=utf-8']],
  ['/bridge-http.js', ['bridge-http.js', 'text/javascript; charset=utf-8']],
  ['/login.html', ['login.html', 'text/html; charset=utf-8']],
]);

/** Ścieżki dostępne BEZ logowania — sama strona logowania i jej obsługa. */
const BEZ_LOGOWANIA = new Set(['/login.html', '/api/login', '/api/session']);

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
    // Sesje żyją w pamięci: restart mostka = ponowne logowanie. Świadomie,
    // bo trwałe sesje trzeba by unieważniać przy zmianie hasła, a zysk jest
    // żaden — mostek restartuje się rzadko.
    this.sesje = new Sesje();
    this.blokada = new Blokada();
    // Ustalane przy starcie: gdzie nasłuchujemy i z jakimi ograniczeniami.
    this.tryb = { host: '127.0.0.1', siec: false, tls: null, readOnly: false, powody: [] };
  }

  /** Czy żądania muszą być uwierzytelnione. Hasło ustawione = tak, zawsze. */
  wymagaLogowania() {
    return hasloUstawione(this.cfg);
  }

  /** Czy zapis jest zablokowany (tryb tylko do odczytu). */
  tylkoOdczyt() {
    return !!this.tryb.readOnly;
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
          // Powody pominięć, żeby dało się odpowiedzieć „skąd te cztery".
          reasons: st.skipReasons || {},
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
        // Odpowiedź na pytanie „jakim znakiem poleci moje QSO" — w jednym
        // miejscu, żeby okno nie musiało jej składać z tabeli konfiguracji.
        podsumowanie: summarizeTargets(
          this.cfg.forward.targets || [],
          this.listener.stats?.lastStation || null,
        ),
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

      // Tryb pracy interfejsu — okno musi wiedzieć, czy pokazać ostrzeżenie
      // o widoczności w sieci i czy wyłączyć przyciski zapisu.
      api: {
        host: this.tryb.host,
        // Port jest TEN SAM przy http i https — TLS zmienia tylko schemat.
        // Brakowało tego w oknie, a pytanie „na jakim porcie jest HTTPS"
        // jest pierwszym, które się zadaje (zgłoszone 2026-09-07).
        port: this.cfg.api?.port ?? null,
        siec: !!this.tryb.siec,
        tls: !!this.tryb.tls,
        tylkoOdczyt: this.tylkoOdczyt(),
        wymagaLogowania: this.wymagaLogowania(),
        // Co było ŻĄDANE w konfiguracji i dlaczego ewentualnie odmówiliśmy.
        // Bez tego okno pokazywało „0.0.0.0" w Konfiguracji i localhost na
        // Stanie, a powód odmowy siedział wyłącznie w logu — czyli tam, gdzie
        // użytkownik nie zagląda (zgłoszone 2026-09-08 z Windowsa, gdzie wtedy
        // nie było czym wystawić certyfikatu; od 0.1.21 mostek wystawia go sam,
        // ale powody odmowy zostały — hasło i wyłączony HTTPS).
        zadanyHost: String(this.cfg.api?.host || '127.0.0.1'),
        odrzucony: (this.tryb.powody || []).length > 0,
        powody: this.tryb.powody || [],
        // Gotowe adresy do wpisania w przeglądarce. Przy nasłuchu na 0.0.0.0
        // sam adres „0.0.0.0" jest bezużyteczny — trzeba znać adresy maszyny.
        adresy: (() => {
          const schemat = this.tryb.tls ? 'https' : 'http';
          const port = this.cfg.api?.port;
          if (!this.tryb.siec) return [`${schemat}://127.0.0.1:${port}/`];
          const hosty = this.tryb.host === '0.0.0.0'
            ? adresyLokalne() : [this.tryb.host];
          return hosty.map((h) => `${schemat}://${h}:${port}/`);
        })(),
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

    // ---------- bramka: logowanie, CSRF, tylko-odczyt ----------
    //
    // Kolejność ma znaczenie i jest tu wypisana wprost, bo pomyłka w niej to
    // dziura, a nie usterka:
    //   1. rzeczy dostępne bez logowania (strona logowania, /api/login, /api/session),
    //   2. brak sesji → 401 dla API, strona logowania dla stron,
    //   3. każdy POST → token CSRF z nagłówka musi zgadzać się z sesją,
    //   4. każdy POST → odrzucony, jeśli tryb tylko do odczytu.
    const ciastko = odczytajCiastko(req.headers.cookie);
    const sesja = this.wymagaLogowania() ? this.sesje.pobierz(ciastko) : null;
    const adres = req.socket?.remoteAddress || '?';

    try {
      if (req.method === 'POST' && url.pathname === '/api/login') {
        return this._logowanie(req, send, res, adres);
      }
      if (req.method === 'POST' && url.pathname === '/api/logout') {
        if (ciastko) this.sesje.usun(ciastko);
        res.setHeader('Set-Cookie', ciastkoWygaszone({ tls: !!this.tryb.tls }));
        return send(200, { ok: true });
      }
      // Stan sesji — potrzebny stronie, żeby wiedzieć, czy pokazać interfejs,
      // i żeby dostać token CSRF. Nigdy nie zdradza, czy hasło jest poprawne.
      if (req.method === 'GET' && url.pathname === '/api/session') {
        return send(200, {
          wymagaLogowania: this.wymagaLogowania(),
          zalogowany: !this.wymagaLogowania() || !!sesja,
          csrf: sesja ? sesja.csrf : null,
          tylkoOdczyt: this.tylkoOdczyt(),
          siec: !!this.tryb.siec,
          tls: !!this.tryb.tls,
        });
      }

      if (this.wymagaLogowania() && !sesja && !BEZ_LOGOWANIA.has(url.pathname)) {
        // Strony oddajemy jako formularz logowania, API jako 401 — inaczej
        // przeglądarka pokazałaby surowy JSON zamiast pola na hasło.
        if (req.method === 'GET' && PLIKI_UI.has(url.pathname)) {
          return this._plikUi('/login.html', res, send);
        }
        return send(401, { error: 'Wymagane logowanie' });
      }

      if (req.method === 'POST') {
        if (this.wymagaLogowania()) {
          const token = req.headers['x-csrf-token'];
          if (!token || !sesja || token !== sesja.csrf) {
            return send(403, { error: 'Brak albo niezgodny token CSRF' });
          }
        }
        if (this.tylkoOdczyt()) {
          return send(403, {
            error: 'Interfejs działa w trybie tylko do odczytu (api.readOnly)',
          });
        }
      }

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
      // Interfejs w przeglądarce — dla maszyn bez pulpitu (malinka) i przez
      // tunel SSH. Serwer nadal słucha WYŁĄCZNIE na 127.0.0.1.
      if (req.method === 'GET' && PLIKI_UI.has(url.pathname)) {
        return this._plikUi(url.pathname, res, send);
      }

      return send(404, { error: 'Nieznany endpoint' });
    } catch (err) {
      log.error('Błąd API stanu', err.message);
      return send(500, { error: err.message });
    }
  }

  /** Serwuje plik interfejsu z listy dozwolonych. */
  _plikUi(sciezka, res, send) {
    const [nazwa, typ] = PLIKI_UI.get(sciezka);
    const plik = join(UI_DIR, nazwa);
    if (!existsSync(plik)) {
      // W paczce bez interfejsu katalogu `ui/` nie ma i to nie jest błąd.
      return send(404, { error: 'Ta wersja nie zawiera interfejsu' });
    }
    res.writeHead(200, { 'Content-Type': typ, 'Cache-Control': 'no-store' });
    res.end(readFileSync(plik));
    return undefined;
  }

  /**
   * Logowanie hasłem.
   *
   * Blokada po nieudanych próbach jest liczona PER ADRES i sprawdzana PRZED
   * policzeniem hasza — inaczej zgadywanie kosztowałoby nas 70 ms procesora
   * na próbę i samo w sobie byłoby atakiem na mostek.
   */
  _logowanie(req, send, res, adres) {
    if (!this.wymagaLogowania()) {
      return send(400, { error: 'Hasło nie jest ustawione — logowanie niepotrzebne' });
    }
    const czekaj = this.blokada.ileCzekac(adres);
    if (czekaj > 0) {
      res.setHeader('Retry-After', String(Math.ceil(czekaj / 1000)));
      return send(429, {
        error: `Za dużo nieudanych prób. Spróbuj po ${Math.ceil(czekaj / 1000)} s.`,
      });
    }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      let haslo = '';
      try { haslo = JSON.parse(body || '{}').password ?? ''; } catch { haslo = ''; }
      if (!sprawdzHaslo(haslo, this.cfg.api.auth.passwordHash)) {
        const kara = this.blokada.nieudana(adres);
        log.warn(`Nieudane logowanie do interfejsu z ${adres}`
          + (kara ? ` — blokada na ${Math.ceil(kara / 1000)} s` : ''));
        return send(401, { error: 'Błędne hasło' });
      }
      this.blokada.udana(adres);
      const s = this.sesje.utworz();
      res.setHeader('Set-Cookie', ciastkoSesji(s.id, { tls: !!this.tryb.tls }));
      log.info(`Zalogowano do interfejsu z ${adres}`);
      return send(200, { ok: true, csrf: s.csrf, tylkoOdczyt: this.tylkoOdczyt() });
    });
    return undefined;
  }

  start() {
    // Tryb ustalamy RAZ, przy starcie. Zmiana adresu czy TLS-a wymaga restartu
    // (jak udp.host) — inaczej trzeba by przenosić otwarte gniazdo i sesje.
    this.tryb = trybApi({ cfg: this.cfg, dataDir: this.cfg._dataDir || process.cwd() });

    return new Promise((resolve) => {
      const obsluga = (req, res) => this._handle(req, res);
      if (this.tryb.tls) {
        try {
          this.server = https.createServer({
            cert: readFileSync(this.tryb.tls.cert),
            key: readFileSync(this.tryb.tls.key),
          }, obsluga);
        } catch (err) {
          log.error(`TLS: nie mogę wczytać certyfikatu (${err.message}) — zostaję na 127.0.0.1`);
          this.tryb = { host: '127.0.0.1', siec: false, tls: null, readOnly: false, powody: [err.message] };
          this.server = http.createServer(obsluga);
        }
      } else {
        this.server = http.createServer(obsluga);
      }

      this.server.on('error', (err) => {
        log.warn(`API stanu niedostępne (${err.message}) – daemon działa dalej`);
        resolve(false);
      });
      this.server.listen(this.cfg.api.port, this.tryb.host, () => {
        const schemat = this.tryb.tls ? 'https' : 'http';
        log.info(`API stanu na ${schemat}://${this.tryb.host}:${this.cfg.api.port}/api/status`);
        if (this.tryb.siec) {
          const odcisk = odciskCertyfikatu(this.tryb.tls.cert);
          log.warn('Interfejs jest widoczny w sieci lokalnej. Wymagane hasło'
            + `${this.tryb.readOnly ? ', tryb tylko do odczytu' : ', Z PRAWEM ZAPISU'}.`);
          if (odcisk) log.info(`Odcisk certyfikatu (SHA-256): ${odcisk}`);
        }
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
