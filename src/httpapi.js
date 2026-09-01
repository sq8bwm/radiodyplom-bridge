// Lokalna powierzchnia stanu dla UI (Electron albo przeglądarka).
//
// Świadome decyzje:
//  - Bind wyłącznie na 127.0.0.1. To interfejs sterujący wysyłką QSO na Twoim
//    PIN-ie; wystawienie go na sieć dałoby obcym kontrolę nad Twoim logiem.
//  - PIN-y NIGDY nie opuszczają procesu — zawsze zamaskowane.
//  - Zero zależności: node:http wystarcza.
import http from 'node:http';
import { log, recentLog } from './log.js';

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
  constructor({ cfg, store, listener, worker, pkg, getPing, getProfile, requeue, getConfig, saveConfig, getPendingRestart, getLogFile }) {
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
    this.server = null;
    this.startedAt = Date.now();
  }

  status() {
    const ping = this.getPing ? this.getPing() : null;
    const counts = this.store.counts();

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
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),

      listener: {
        host: this.listener.host,
        port: this.listener.port,
        multicastGroups: this.listener.multicastGroups,
        localOnly: this.listener.host === '127.0.0.1',
        stats: this.listener.stats,
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
      },

      forward: {
        operations: this.cfg.forward.operations,
        targets: (this.cfg.forward.targets || []).map((t) => ({
          station_callsign: t.station_callsign,
          operator: t.operator || null,
          pin: t.pin ? maskPin(t.pin) : null,
        })),
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
      if (req.method === 'POST' && url.pathname === '/api/requeue') {
        const n = this.requeue ? this.requeue() : 0;
        return send(200, { ok: true, restored: n });
      }
      if (req.method === 'GET' && url.pathname === '/api/config') {
        if (!this.getConfig) return send(501, { error: 'Edycja konfiguracji niedostępna' });
        return send(200, this.getConfig());
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
