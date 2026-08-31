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
import { editableConfig, applyConfig } from './configedit.js';
import { log, setLevel, recentLog } from './log.js';
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
        log.debug(`QSO ${item.payload.callsign} już znane (dedup)`, { key: item.key });
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
    pendingRestart: new Set(),  // ustawienia czekające na restart   // ostatni ZNANY profil – nie gubimy go przy awarii łączności
    pause: () => worker.pause(),
    resume: () => worker.resume(),
    requeue: () => requeueFailed(store).restored,
    status: () => handle.api.status(),
    getConfig: () => editableConfig(cfg),
    saveConfig: (patch) => applyConfig(handle, patch),
    log: (n) => recentLog(n),
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
    getPendingRestart: () => [...(handle.pendingRestart || [])],
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
    if (before !== handle.lastPing.ok) {
      if (handle.lastPing.ok) log.info('Łączność z API przywrócona');
      else log.warn(`Utracono łączność z API: ${handle.lastPing.error}`);
    }
  }, pingEveryMs);
  handle.pingTimer.unref?.();

  // PIN autoryzuje tylko własny profil – ostrzeż, zanim wyjdzie to na pierwszym QSO.
  if (handle.lastPing.ok) {
    for (const t of cfg.forward.targets || []) {
      const station = String(t.station_callsign).toUpperCase();
      if (!t.pin && station !== String(handle.lastPing.operator || '').toUpperCase()) {
        log.warn(
          `Cel fan-outu ${station} nie ma własnego "pin", a PIN główny należy do ${handle.lastPing.operator}. `
          + 'Ta kopia najpewniej wróci jako NOT_SAVED – dodaj PIN profilu tej stacji.',
        );
      }
    }
  }

  return handle;
}
