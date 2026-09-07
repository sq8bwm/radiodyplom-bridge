// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Odczyt i zapis konfiguracji dla UI.
//
// Zasada bezpieczeństwa: UI nigdy nie dostaje jawnych PIN-ów. Dostaje wersję
// zamaskowaną, a przy zapisie wartość zamaskowana (albo pusta) znaczy
// „zostaw dotychczasowy PIN". Dzięki temu edycja innych pól nie wymaga
// przesyłania sekretu tam i z powrotem.
import { readFileSync, existsSync } from 'node:fs';
import { writeAtomic } from './atomic.js';
import { configPath, isPinMissing } from './config.js';
import { maskPin } from './httpapi.js';
import { zahaszujHaslo, hasloUstawione } from './apiauth.js';
import { log, setLevel } from './log.js';
import { EVENT_RING } from './worker.js';

/**
 * Dozwolone motywy — ta sama lista co `THEMES` w `ui/strings.js`.
 *
 * Wypisana tu OSOBNO, nie zaimportowana: pakiet headless kopiuje wyłącznie
 * `src/`, więc import z `ui/` położyłby usługę na malince komunikatem
 * „Cannot find module". Sprawdzone doświadczalnie 2026-09-07. Zgodność obu
 * list pilnuje test `test/konfiguracja-motyw.test.js`.
 */
const THEMES = ['auto', 'light', 'dark'];

/** Zmiany wymagające restartu (nie da się ich zastosować na żywo). */
const RESTART_KEYS = ['udp.host', 'udp.port', 'udp.multicastGroups', 'api.port', 'api.enabled',
  'dataDir', 'queue.dir', 'queue.failedDir', 'queue.seenFile',
  // Adres nasłuchu i TLS ustalane są raz, przy starcie serwera — zmiana
  // w locie znaczyłaby przenoszenie otwartego gniazda i sesji.
  'api.host', 'api.readOnly', 'api.tls.enabled'];

/** Konfiguracja w postaci bezpiecznej do pokazania w UI. */
export function editableConfig(cfg) {
  return {
    udp: {
      host: cfg.udp.host,
      port: cfg.udp.port,
      multicastGroups: cfg.udp.multicastGroups || [],
    },
    dataDir: cfg.dataDir ?? null,
    radiodyplom: {
      apiUrl: cfg.radiodyplom.apiUrl,
      pin: maskPin(cfg.radiodyplom.pin),
      pinSet: !!cfg.radiodyplom.pin,
      // Interfejs musi wiedzieć, że zmiana tutaj nic nie da: przy następnym
      // starcie wartość ze środowiska i tak wygra.
      pinFromEnv: !!cfg._zEnv?.pin,
      timeoutMs: cfg.radiodyplom.timeoutMs,
      dryRun: !!cfg.radiodyplom.dryRun,
    },
    forward: {
      operations: cfg.forward.operations,
      targets: (cfg.forward.targets || []).map((t) => ({
        station_callsign: t.station_callsign,
        operator: t.operator || null,
        pin: t.pin ? maskPin(t.pin) : null,
        pinSet: !!t.pin,
        enabled: t.enabled !== false,
      })),
    },
    rateLimit: cfg.rateLimit,
    queue: cfg.queue,
    // Hasła NIE oddajemy nawet w postaci hasza — interfejs potrzebuje tylko
    // wiedzieć, czy jest ustawione, dokładnie jak przy PIN-ach.
    api: {
      enabled: cfg.api?.enabled !== false,
      port: cfg.api?.port,
      host: cfg.api?.host || '127.0.0.1',
      readOnly: cfg.api?.readOnly ?? null,
      auth: {
        passwordSet: hasloUstawione(cfg),
        passwordFromEnv: !!cfg._zEnv?.apiPasswordHash,
      },
      tls: {
        enabled: cfg.api?.tls?.enabled !== false,
        certFile: cfg.api?.tls?.certFile || null,
        keyFile: cfg.api?.tls?.keyFile || null,
      },
    },
    logLevel: cfg.logLevel,
    language: cfg.language || 'pl',
    // Bez tej linii wybór motywu żył tylko w pamięci: plik zaczyna się od
    // rozsypania swojej dotychczasowej treści, więc stara wartość wygrywała
    // i po restarcie okno wracało do poprzedniego motywu.
    theme: THEMES.includes(cfg.theme) ? cfg.theme : 'auto',
    ui: { recentEvents: cfg.ui?.recentEvents ?? 20 },
  };
}

/** Czy przysłana wartość PIN-u to „bez zmian"? */
function keepExisting(value) {
  return value === undefined || value === null || value === '' || String(value).includes('*');
}

/**
 * Scala listę celów z UI z dotychczasową, odmaskowując PIN-y.
 *
 * Wydzielone z `applyConfig`, bo tej samej listy potrzebuje sprawdzanie
 * konfiguracji PRZED zapisem: żeby zapytać serwis o uprawnienia, trzeba znać
 * prawdziwy PIN celu, a UI przysyła go zamaskowanego.
 *
 * @param {object[]} patchTargets  cele przysłane z UI
 * @param {object[]} previous      cele dotychczasowe (źródło PIN-ów)
 */
export function mergeTargets(patchTargets, previous = []) {
  return (Array.isArray(patchTargets) ? patchTargets : [])
    .filter((t) => t && String(t.station_callsign || '').trim())
    .map((t) => {
      const station = String(t.station_callsign).trim().toUpperCase();
      const out = { station_callsign: station, enabled: t.enabled !== false };
      if (t.operator) out.operator = String(t.operator).trim().toUpperCase();

      // PIN celu ma CZTERY stany i wszystkie trzeba rozróżniać:
      //  - pola NIE przysłano (undefined) → zostaw dotychczasowy,
      //  - zamaskowany                    → zostaw dotychczasowy,
      //  - nowa wartość                   → zapisz ją,
      //  - przysłany PUSTY                → usuń (kopia poleci PIN-em głównym).
      //
      // Rozróżnienie „nie przysłano" od „przysłano puste" jest istotne:
      // bez niego klient, który o tym polu nie wie (starsze okno, skrypt
      // wołający /api/config), po cichu kasowałby cudze PIN-y. Usunięcie
      // musi być jawną decyzją, a okno pyta o nią wprost.
      const prev = previous.find((p) => String(p.station_callsign).toUpperCase() === station);
      const przyslany = t.pin !== undefined && t.pin !== null;
      const zamaskowany = typeof t.pin === 'string' && t.pin.includes('*');
      const nowy = przyslany && !zamaskowany && String(t.pin).trim() !== '';
      if (nowy) {
        out.pin = String(t.pin).trim();
      } else if (!przyslany || zamaskowany) {
        if (prev?.pin) out.pin = prev.pin;
      }
      // przysłany i pusty → celowo nic nie ustawiamy: PIN usunięty
      return out;
    });
}

/** PIN główny po scaleniu z tym, co przysłało UI (zamaskowany = bez zmian). */
export function mergeMainPin(patchPin, previousPin) {
  return keepExisting(patchPin) ? (previousPin || null) : String(patchPin).trim();
}

/**
 * Scala zmiany z UI, zapisuje config.json i stosuje na żywo, co się da.
 * @returns {{saved:boolean, restartRequired:string[], path:string}}
 */
export function applyConfig(daemon, patch) {
  const cfg = daemon.cfg;
  const restartRequired = [];
  let pinChanged = false;

  // Porównanie z normalizacją: brak klucza i pusta lista to ta sama rzecz.
  // Bez tego zapis niezmienionej konfiguracji kazałby restartować bez powodu.
  const norm = (v) => JSON.stringify(v === undefined || v === null ? null
    : (Array.isArray(v) && v.length === 0 ? null : v));
  const mark = (key, oldV, newV) => {
    if (newV === undefined) return;                 // pola nieprzysłanego nie zmieniamy
    if (norm(oldV) !== norm(newV) && RESTART_KEYS.includes(key)) {
      restartRequired.push(key);
    }
  };

  // --- radiodyplom ---
  if (patch.radiodyplom) {
    const r = patch.radiodyplom;
    if (r.apiUrl) cfg.radiodyplom.apiUrl = String(r.apiUrl);
    if (typeof r.timeoutMs === 'number') cfg.radiodyplom.timeoutMs = r.timeoutMs;
    if (typeof r.dryRun === 'boolean') cfg.radiodyplom.dryRun = r.dryRun;
    if (!keepExisting(r.pin)) {
      if (cfg._zEnv?.pin) {
        log.warn('PIN pochodzi z RD_PIN (pin.env) — zmiana z interfejsu '
          + 'pominięta. Zmień go tam.');
      } else {
        cfg.radiodyplom.pin = String(r.pin).trim();
        pinChanged = true;
      }
    }
  }

  // --- cele fan-outu ---
  if (Array.isArray(patch.forward?.targets)) {
    cfg.forward.targets = mergeTargets(patch.forward.targets, cfg.forward.targets || []);
  }
  if (Array.isArray(patch.forward?.operations)) {
    cfg.forward.operations = patch.forward.operations;
  }

  // --- wymagające restartu ---
  if (patch.udp) {
    mark('udp.host', cfg.udp.host, patch.udp.host);
    mark('udp.port', cfg.udp.port, patch.udp.port);
    mark('udp.multicastGroups', cfg.udp.multicastGroups, patch.udp.multicastGroups);
    if (patch.udp.host) cfg.udp.host = String(patch.udp.host);
    if (patch.udp.port) cfg.udp.port = Number(patch.udp.port);
    if (Array.isArray(patch.udp.multicastGroups)) cfg.udp.multicastGroups = patch.udp.multicastGroups;
  }
  if (patch.dataDir !== undefined) {
    mark('dataDir', cfg.dataDir ?? null, patch.dataDir);
    cfg.dataDir = patch.dataDir || undefined;
  }
  if (patch.api) {
    mark('api.port', cfg.api.port, patch.api.port);
    mark('api.enabled', cfg.api.enabled, patch.api.enabled);
    if (patch.api.port) cfg.api.port = Number(patch.api.port);
    if (typeof patch.api.enabled === 'boolean') cfg.api.enabled = patch.api.enabled;

    // Adres nasłuchu. Sama wartość nic nie otwiera: przy starcie `trybApi`
    // sprawdza hasło i certyfikat, a przy braku któregokolwiek zostaje na
    // localhoście. Dlatego zapis jest dozwolony bez ceregieli — bramka jest
    // w jednym miejscu, nie rozsypana po walidacji.
    if (patch.api.host !== undefined) {
      mark('api.host', cfg.api.host || '127.0.0.1', patch.api.host || '127.0.0.1');
      cfg.api.host = String(patch.api.host || '127.0.0.1');
    }
    if (patch.api.readOnly !== undefined) {
      const v = patch.api.readOnly === null ? null : !!patch.api.readOnly;
      mark('api.readOnly', cfg.api.readOnly ?? null, v);
      if (v === null) delete cfg.api.readOnly; else cfg.api.readOnly = v;
    }
    if (patch.api.tls) {
      cfg.api.tls = cfg.api.tls || {};
      if (typeof patch.api.tls.enabled === 'boolean') {
        mark('api.tls.enabled', cfg.api.tls.enabled !== false, patch.api.tls.enabled);
        cfg.api.tls.enabled = patch.api.tls.enabled;
      }
      for (const k of ['certFile', 'keyFile']) {
        if (patch.api.tls[k] !== undefined) cfg.api.tls[k] = patch.api.tls[k] || undefined;
      }
    }
    // Hasło przychodzi JAWNE i wychodzi jako hasz. Pustej wartości nie
    // traktujemy jako „usuń" — do tego jest osobne `passwordClear`, żeby
    // literówka w formularzu nie zdjęła ochrony z nasłuchu w sieci.
    if (patch.api.auth) {
      cfg.api.auth = cfg.api.auth || {};
      if (cfg._zEnv?.apiPasswordHash) {
        // Zmiana z okna zadziałałaby do najbliższego restartu i zniknęła —
        // wartość ze środowiska wygrywa przy każdym starcie. Lepiej powiedzieć
        // wprost, niż pozwolić ustawić hasło, które przestanie działać.
        if (patch.api.auth.password || patch.api.auth.passwordClear) {
          log.warn('Hasło do interfejsu pochodzi z RD_API_PASSWORD_HASH '
            + '(pin.env) — zmiana z interfejsu pominięta. Zmień je tam.');
        }
      } else if (patch.api.auth.passwordClear === true) {
        delete cfg.api.auth.passwordHash;
      } else if (patch.api.auth.password) {
        cfg.api.auth.passwordHash = zahaszujHaslo(patch.api.auth.password);
      }
    }
  }
  if (patch.ui && patch.ui.recentEvents !== undefined) {
    // Te same widełki co przy wczytywaniu — inaczej dałoby się je obejść
    // zapisem z interfejsu, a status puchłby przy każdym odpytaniu.
    const n = Number(patch.ui.recentEvents);
    cfg.ui = cfg.ui || {};
    if (Number.isFinite(n)) cfg.ui.recentEvents = Math.max(5, Math.min(EVENT_RING, Math.round(n)));
  }
  if (patch.rateLimit) Object.assign(cfg.rateLimit, patch.rateLimit);
  if (patch.logLevel) cfg.logLevel = patch.logLevel;
  if (patch.language) cfg.language = String(patch.language);
  // Motyw walidujemy wobec listy, a nie zapisujemy co przyszło: wartość z tego
  // pola wraca do CSS-a jako atrybut, a nieznana zostawiłaby okno bez palety.
  if (patch.theme !== undefined) {
    cfg.theme = THEMES.includes(patch.theme) ? patch.theme : 'auto';
  }

  // --- zastosuj na żywo, co się da ---
  // Flagę „brak PIN-u" trzeba przeliczyć, inaczej interfejs pokazywałby
  // komunikat o braku PIN-u także po jego wpisaniu, aż do restartu.
  cfg._pinMissing = isPinMissing(cfg.radiodyplom.pin);

  daemon.client.apiUrl = cfg.radiodyplom.apiUrl;
  daemon.client.dryRun = !!cfg.radiodyplom.dryRun;
  daemon.client.pin = cfg.radiodyplom.pin;
  daemon.client.timeoutMs = cfg.radiodyplom.timeoutMs;
  daemon.listener.pin = cfg.radiodyplom.pin;
  daemon.listener.targets = cfg.forward.targets || [];
  daemon.listener.operations = new Set(cfg.forward.operations || ['insert']);
  daemon.worker.maxPerMinute = cfg.rateLimit.maxPerMinute;
  daemon.worker.minSpacingMs = cfg.rateLimit.minSpacingMs;
  setLevel(cfg.logLevel || 'info');

  // Po zmianie PIN-u nie każemy czekać do następnego cyklicznego PING-a —
  // użytkownik właśnie go wpisał i chce od razu wiedzieć, czy działa.
  if (pinChanged && typeof daemon.refreshPing === 'function') daemon.refreshPing();

  // Uprawnienia sprawdzamy po każdym zapisie: mogła dojść nowa reguła albo
  // nowy PIN celu. Bez `await` — zapis konfiguracji nie ma czekać na sieć.
  if (typeof daemon.refreshAccounts === 'function') {
    Promise.resolve(daemon.refreshAccounts()).catch(() => { /* sprawdzanie to wygoda */ });
  }

  const path = writeConfigFile(cfg);

  // Zapamiętujemy trwale, co czeka na restart. Jednorazowy komunikat po zapisie
  // ginął przy przełączeniu zakładki, a interfejs pokazywał wtedy nową wartość
  // w konfiguracji i starą w stanie — bez żadnego powiązania między nimi.
  daemon.pendingRestart = daemon.pendingRestart || new Set();
  for (const k of restartRequired) daemon.pendingRestart.add(k);

  const pending = [...daemon.pendingRestart];
  log.info('Konfiguracja zapisana', { path, restartRequired: pending });

  return { saved: true, restartRequired: [...new Set(restartRequired)], pendingRestart: pending, path };
}

/** Zapisuje config.json atomowo, bez pól wewnętrznych i bez ścieżek rozwiniętych. */
export function writeConfigFile(cfg) {
  // Zachowaj oryginalne (względne) ścieżki z pliku, jeśli istnieje –
  // w pamięci mamy je rozwinięte do bezwzględnych i nie chcemy ich utrwalać.
  let original = {};
  const target = configPath();
  if (existsSync(target)) {
    try { original = JSON.parse(readFileSync(target, 'utf8')); } catch { /* nadpiszemy */ }
  }

  // Zaczynamy od tego, co JEST w pliku, i nadpisujemy tylko pola, którymi
  // zarządza interfejs. Wcześniej plik był budowany od zera z ustalonej listy
  // kluczy, więc każdy zapis z UI wycinał sekcje, o których ta lista nie
  // wiedziała — realnie ginęły `logFile` i `radiodyplom.pingIntervalMs`.
  const out = {
    ...original,
    udp: {
      ...(original.udp || {}),
      host: cfg.udp.host,
      port: cfg.udp.port,
      multicastGroups: cfg.udp.multicastGroups || [],
    },
    radiodyplom: {
      ...(original.radiodyplom || {}),
      apiUrl: cfg.radiodyplom.apiUrl,
      // PIN ze zmiennej środowiskowej (pin.env) NIE trafia do pliku — plik ma
      // prawa 0644 i bywa wklejany do zgłoszeń, a `pin.env` istnieje właśnie
      // po to, żeby sekret tam nie leżał. Sprawdzone 2026-09-07: bez tego
      // pierwszy zapis z okna przepisywał PIN do config.json.
      ...(cfg._zEnv?.pin ? {} : { pin: cfg.radiodyplom.pin }),
      timeoutMs: cfg.radiodyplom.timeoutMs,
      dryRun: !!cfg.radiodyplom.dryRun,
    },
    forward: {
      ...(original.forward || {}),
      operations: cfg.forward.operations,
      targets: cfg.forward.targets || [],
    },
    queue: original.queue || cfg.queue,
    rateLimit: cfg.rateLimit,
    // To samo dla hasza hasła do interfejsu: jeśli przyszedł z RD_API_PASSWORD_HASH,
    // zostawiamy w pliku to, co tam było (najczęściej nic).
    api: (() => {
      const out = { ...(original.api || {}), ...cfg.api };
      if (cfg._zEnv?.apiPasswordHash) {
        const zPliku = original.api?.auth?.passwordHash;
        out.auth = { ...(out.auth || {}) };
        if (zPliku === undefined) delete out.auth.passwordHash;
        else out.auth.passwordHash = zPliku;
      }
      return out;
    })(),
    logLevel: cfg.logLevel,
    language: cfg.language || 'pl',
    // Bez tej linii wybór motywu żył tylko w pamięci: plik zaczyna się od
    // rozsypania swojej dotychczasowej treści, więc stara wartość wygrywała
    // i po restarcie okno wracało do poprzedniego motywu.
    theme: cfg.theme || 'auto',
    ui: { ...(original.ui || {}), recentEvents: cfg.ui?.recentEvents ?? 20 },
  };
  if (cfg.dataDir) out.dataDir = cfg.dataDir;
  else delete out.dataDir;

  return writeAtomic(target, JSON.stringify(out, null, 2));
}
