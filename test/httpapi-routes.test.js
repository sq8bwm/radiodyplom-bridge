// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Trasy lokalnego API stanu.
//
// Po co: dodając `/api/problems/ack` wywołałam nieistniejącą funkcję i trasa
// rzucała „json is not defined". Cały zestaw testów przeszedł, bo ŻADEN nie
// dotykał warstwy HTTP — usterkę zobaczyłam dopiero na uruchomionym programie.
// Ten test przechodzi po wszystkich trasach, żeby taka wpadka nie powtórzyła się
// przy następnej.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { StatusApi } from '../src/httpapi.js';
import { setLevel } from '../src/log.js';

setLevel('error');

const PORT = 12777;
const base = `http://127.0.0.1:${PORT}`;

const cfg = {
  api: { enabled: true, port: PORT },
  udp: { host: '127.0.0.1', port: 12778, multicastGroups: [] },
  radiodyplom: { apiUrl: 'http://x/y', pin: 'AAAA-1111', dryRun: true },
  forward: { operations: ['insert'], targets: [] },
  queue: { maxAttempts: 20 },
  rateLimit: { maxPerMinute: 9, minSpacingMs: 700 },
  logLevel: 'error',
  ui: { recentEvents: 7 },
  _pinMissing: false,
};

let api;
let acked = 0;
let discarded = 0;

before(async () => {
  api = new StatusApi({
    cfg,
    store: {
      counts: () => ({ pending: 0, failed: 4, sent: 0, skipped: 0 }),
      list: () => [],
      listFailed: () => [{ payload: { callsign: 'SP1AAA', station_callsign: 'SN0LPU' },
        lastErrorCode: 'NOT_SAVED', lastError: 'brak akcji' }],
      unackedFailed: () => 3,
      ackFailed() { acked += 1; return 3; },
      discardFailed() { discarded += 1; return { removed: 4, calls: ['SP1AAA'] }; },
    },
    listener: { host: '127.0.0.1', port: 12778, multicastGroups: [], stats: { received: 0, bySource: {} } },
    worker: {
      paused: false,
      online: true,
      counters: { sent: 0, duplicates: 0, failed: 0, retries: 0 },
      lastSent: null,
      lastError: null,
      recentEvents: (n) => Array.from({ length: n }, (_, i) => ({ kind: 'sent', callsign: `SP${i}` })),
      pause() { this.paused = true; },
      resume() { this.paused = false; },
    },
    pkg: { name: 'radiodyplom-bridge', version: '9.9.9', license: 'GPL-3.0-or-later' },
    getPing: () => ({ ok: true, operator: 'SQ8BWM' }),
    requeue: () => 2,
    getConfig: () => ({ ui: { recentEvents: 7 } }),
    getPendingRestart: () => [],
    getLogFile: () => '/tmp/x.log',
  });
  assert.equal(await api.start(), true, 'API musi wstać');
});

after(() => api.stop());

const get = (p) => fetch(base + p);
const post = (p) => fetch(base + p, { method: 'POST' });

describe('API stanu — każda trasa odpowiada', () => {
  test('GET /api/status', async () => {
    const r = await get('/api/status');
    assert.equal(r.status, 200);
    const s = await r.json();
    assert.equal(s.version, '9.9.9');
    assert.equal(s.license, 'GPL-3.0-or-later');
    assert.equal(s.problems.count, 3, 'liczba z katalogu odrzuconych, nie z pamięci');
    assert.equal(s.problems.last.code, 'NOT_SAVED', 'szczegóły z najnowszego odrzuconego');
    assert.equal(s.recentEventsMax, 7);
    assert.equal(s.recentEvents.length, 7, 'liczba zdarzeń idzie z konfiguracji');
  });

  test('GET /api/log', async () => {
    const r = await get('/api/log?n=5');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray((await r.json()).entries));
  });

  test('POST /api/pause i /api/resume', async () => {
    assert.equal((await (await post('/api/pause')).json()).paused, true);
    assert.equal((await (await post('/api/resume')).json()).paused, false);
  });

  test('POST /api/requeue', async () => {
    assert.equal((await (await post('/api/requeue')).json()).restored, 2);
  });

  test('POST /api/problems/ack', async () => {
    // REGRESJA: ta trasa rzucała wyjątkiem zamiast odpowiedzieć.
    const before = acked;
    const r = await post('/api/problems/ack');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.equal(body.cleared, 3);
    assert.equal(acked, before + 1, 'store musi zostać naprawdę wywołany');
  });

  test('POST /api/failed/discard', async () => {
    const before = discarded;
    const r = await post('/api/failed/discard');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.equal(body.removed, 4);
    assert.equal(discarded, before + 1, 'store musi zostać naprawdę wywołany');
  });

  test('GET /api/config', async () => {
    const r = await get('/api/config');
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ui.recentEvents, 7);
  });

  test('żadna trasa nie zwraca 500', async () => {
    // Sedno: wyjątek w uchwycie objawia się piątką, a nie brakiem trasy.
    for (const [m, p] of [['GET', '/api/status'], ['GET', '/api/log'], ['GET', '/api/config'],
      ['POST', '/api/pause'], ['POST', '/api/resume'], ['POST', '/api/requeue'],
      ['POST', '/api/problems/ack'], ['POST', '/api/failed/discard']]) {
      const r = await fetch(base + p, { method: m });
      assert.ok(r.status < 500, `${m} ${p} → ${r.status}`);
    }
  });

  test('nieznana trasa to 404, nie wywrotka', async () => {
    assert.equal((await get('/api/nie-ma-takiej')).status, 404);
  });
});
