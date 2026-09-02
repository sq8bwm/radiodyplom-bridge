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
import { log, setLevel } from './log.js';

/** Zmiany wymagające restartu (nie da się ich zastosować na żywo). */
const RESTART_KEYS = ['udp.host', 'udp.port', 'udp.multicastGroups', 'api.port', 'api.enabled',
  'dataDir', 'queue.dir', 'queue.failedDir', 'queue.seenFile'];

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
      })),
    },
    rateLimit: cfg.rateLimit,
    queue: cfg.queue,
    api: cfg.api,
    logLevel: cfg.logLevel,
    language: cfg.language || 'pl',
  };
}

/** Czy przysłana wartość PIN-u to „bez zmian"? */
function keepExisting(value) {
  return value === undefined || value === null || value === '' || String(value).includes('*');
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
      cfg.radiodyplom.pin = String(r.pin).trim();
      pinChanged = true;
    }
  }

  // --- cele fan-outu ---
  if (Array.isArray(patch.forward?.targets)) {
    const previous = cfg.forward.targets || [];
    cfg.forward.targets = patch.forward.targets
      .filter((t) => t && String(t.station_callsign || '').trim())
      .map((t) => {
        const station = String(t.station_callsign).trim().toUpperCase();
        const out = { station_callsign: station };
        if (t.operator) out.operator = String(t.operator).trim().toUpperCase();
        if (!keepExisting(t.pin)) {
          out.pin = String(t.pin).trim();
        } else {
          // Zamaskowany PIN → zachowaj dotychczasowy dla tej samej stacji.
          // Pole `pin` w celu jest drogą z 0.1.x i nie ma go w interfejsie,
          // ale zapis z okna nie może go po cichu skasować.
          const prev = previous.find((p) => String(p.station_callsign).toUpperCase() === station);
          if (prev?.pin) out.pin = prev.pin;
        }
        return out;
      });
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
  }
  if (patch.rateLimit) Object.assign(cfg.rateLimit, patch.rateLimit);
  if (patch.logLevel) cfg.logLevel = patch.logLevel;
  if (patch.language) cfg.language = String(patch.language);

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
      pin: cfg.radiodyplom.pin,
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
    api: cfg.api,
    logLevel: cfg.logLevel,
    language: cfg.language || 'pl',
  };
  if (cfg.dataDir) out.dataDir = cfg.dataDir;
  else delete out.dataDir;

  return writeAtomic(target, JSON.stringify(out, null, 2));
}
