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

import { StatusApi, maskPin } from '../src/httpapi.js';
import { setLevel } from '../src/log.js';

setLevel('error');

const PORT = 12777;
const base = `http://127.0.0.1:${PORT}`;

const cfg = {
  api: { enabled: true, port: PORT },
  udp: { host: '127.0.0.1', port: 12778, multicastGroups: [] },
  radiodyplom: { apiUrl: 'http://x/y', pin: 'AAAA-1111', dryRun: true },
  forward: { operations: ['insert'], targets: [
    { station_callsign: 'SN8N' },
    { station_callsign: 'SP9XYZ', pin: 'BBBB-2222' },
  ] },
  queue: { maxAttempts: 20, journalDir: '/tmp/rd-nie-ma-takiego-katalogu' },
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
      counts: () => ({ pending: 0, failed: 4, sent: 1119, dryRun: 2, skipped: 7 }),
      list: () => [],
      listFailed: () => [{ payload: { callsign: 'SP1AAA', station_callsign: 'SN0LPU' },
        lastErrorCode: 'NOT_SAVED', lastError: 'brak akcji' }],
      unackedFailed: () => 3,
      ackFailed() { acked += 1; return 3; },
      discardFailed() { discarded += 1; return { removed: 4, calls: ['SP1AAA'] }; },
    },
    listener: { host: '127.0.0.1', port: 12778, multicastGroups: [],
      stats: { received: 191, accepted: 189, skipped: 2, invalid: 0, unknown: 0,
        bySource: { QLog: 189 }, skipReasons: { 'operacja "update"': 2 } } },
    worker: {
      paused: false,
      online: true,
      counters: { sent: 567, dryRun: 3, duplicates: 0, failed: 0, retries: 0 },
      lastSent: null,
      lastError: null,
      recentEvents: (n) => Array.from({ length: n }, (_, i) => ({ kind: 'sent', callsign: `SP${i}` })),
      pause() { this.paused = true; },
      resume() { this.paused = false; },
    },
    pkg: { name: 'radiodyplom-bridge', version: '9.9.9', license: 'GPL-3.0-or-later' },
    getPing: () => ({ ok: true, operator: 'SQ8BWM', stations: ['SN8N'],
      activeActions: [{ id: 295 }], pinExpires: null, apiEnabled: true }),
    requeue: () => 2,
    getConfig: () => ({ ui: { recentEvents: 7 } }),
    getPendingRestart: () => [],
    getUpdate: () => ({ ok: true, latest: '0.1.11', url: 'https://x/rel',
      newer: true, checkedAt: '2026-09-04T18:00:00.000Z' }),
    getLogFile: () => '/tmp/x.log',
    getAccountChecks: () => [
      { station: 'SN8N', enabled: true, pinSource: 'main', operator: 'SQ8BWM', state: 'ok', blocking: false },
      { station: 'SP9XYZ', enabled: true, pinSource: 'own', operator: 'SQ8BWA', state: 'missing-station', blocking: true },
    ],
    checkConfig: async (patch) => {
      if (patch?.wywalSie) throw new Error('serwis nie odpowiada');
      return [{ station: 'SN8N', enabled: true, state: 'ok', blocking: false }];
    },
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

  test('GET /api/status — liczby sesji oddzielone od trwałych', async () => {
    // REGRESJA (zrzut z 2026-09-03): karta „wysłane" pokazywała 1119 przy 191
    // odebranych, bo pierwsza liczba jest trwała i w kopiach, a druga — z tego
    // procesu i w datagramach. Status musi je rozdzielać, inaczej każde okno
    // wymyśla tę arytmetykę na nowo.
    const s = await (await get('/api/status')).json();
    assert.equal(s.queue.sent, 1119, 'licznik trwały');
    assert.equal(s.queue.dryRun, 2, 'przejścia próbne osobno');
    assert.equal(s.session.copies, 567, 'kopie wysłane w tej sesji');
    assert.equal(s.session.qso, 189, 'QSO przyjęte z loggerów w tej sesji');
    assert.equal(s.session.received, 191, 'wszystkie datagramy');
    assert.equal(s.session.notDecoded, 2, '191 − 189: datagramy bez QSO');
    assert.equal(s.session.dryRun, 3, 'przejścia próbne tej sesji osobno od kopii');
    assert.ok(s.session.since, 'od kiedy liczymy');
  });

  test('GET /api/status — rozbicie datagramów bez QSO', async () => {
    const s = await (await get('/api/status')).json();
    assert.deepEqual(s.listener.notDecoded,
      { total: 2, unknown: 0, invalid: 0, skipped: 2, reasons: { 'operacja "update"': 2 } },
      'różnica musi być widoczna z podziałem na przyczyny i z POWODEM');
  });

  test('GET /api/status — nowsze wydanie w stanie', async () => {
    const s = await (await get('/api/status')).json();
    assert.equal(s.update.available, true);
    assert.equal(s.update.latest, '0.1.11');
    assert.equal(s.update.url, 'https://x/rel');
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

  test('GET /api/status — opis konta i ocena celów', async () => {
    const s = await (await get('/api/status')).json();
    assert.deepEqual(s.radiodyplom.account.stations, ['SN8N']);
    assert.equal(s.radiodyplom.account.apiEnabled, true);
    const [a, b] = s.forward.targets;
    assert.equal(a.check.state, 'ok');
    assert.equal(b.check.state, 'missing-station');
    assert.equal(b.check.blocking, true);
    assert.equal(b.check.operator, 'SQ8BWA', 'komunikat ma nazwać konto, którego brak dotyczy');
    assert.equal(b.pin, maskPin('BBBB-2222'), 'PIN celu nadal zamaskowany');
  });

  test('POST /api/config/check', async () => {
    const r = await post('/api/config/check');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.equal(body.checks[0].state, 'ok');
  });

  test('błąd sprawdzania NIE blokuje zapisu — 200 z ok:false, nie piątka', async () => {
    // Sedno: sprawdzanie to wygoda. Gdyby padało piątką, okno musiałoby
    // zgadywać, czy zapis wolno wykonać — a wolno ZAWSZE.
    const r = await fetch(base + '/api/config/check', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wywalSie: true }),
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, false);
    assert.deepEqual(body.checks, []);
  });

  test('GET /api/stats — pusty dziennik nie wywala trasy', async () => {
    const r = await get('/api/stats');
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.ok, true);
    assert.equal(b.total.qso, 0);
    assert.deepEqual(b.perDay, []);
  });

  test('GET /api/stats — zły zakres jest ignorowany, nie przyjmowany', async () => {
    // Data z żądania idzie do porównań łańcuchowych; wpuszczenie czegokolwiek
    // dawałoby ciche, niezrozumiałe wyniki.
    const b = await (await get('/api/stats?from=wczoraj&to=2026-13-99')).json();
    assert.equal(b.from, null);
    assert.equal(b.to, null);
  });

  test('GET /api/stats — filtr przyjmuje tylko wartości obecne w danych', async () => {
    // Dziennik w teście jest pusty, więc żadna wartość nie jest dozwolona
    // i filtr musi zostać ODRZUCONY, a nie przepuszczony dalej.
    const b = await (await get('/api/stats?operator=SQ8BWM&station=NIE-MA')).json();
    assert.equal(b.filters.operator, null);
    assert.equal(b.filters.station, null);
    assert.deepEqual(b.options, { operators: [], stations: [] });
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
      ['POST', '/api/problems/ack'], ['POST', '/api/failed/discard'],
      ['POST', '/api/config/check'], ['GET', '/api/stats']]) {
      const r = await fetch(base + p, { method: m });
      assert.ok(r.status < 500, `${m} ${p} → ${r.status}`);
    }
  });

  test('strona interfejsu jest oddawana po HTTP', async () => {
    // Dla maszyn bez pulpitu: to samo okno, ale w przeglądarce.
    for (const [sciezka, typ] of [
      ['/', 'text/html'], ['/index.html', 'text/html'],
      ['/renderer.js', 'text/javascript'], ['/strings.js', 'text/javascript'],
      ['/bridge-http.js', 'text/javascript'],
    ]) {
      const r = await get(sciezka);
      assert.equal(r.status, 200, sciezka);
      assert.match(r.headers.get('content-type'), new RegExp(typ), sciezka);
      assert.equal(r.headers.get('cache-control'), 'no-store',
        'strona ma pokazywać bieżący stan, nie wersję sprzed aktualizacji');
    }
  });

  test('poza listą dozwolonych plików nie ma nic', async () => {
    // Świadomie lista dozwolonych zamiast mapowania ścieżki na dysk — przy
    // mapowaniu każda literówka w sprawdzaniu `..` oddaje cudze pliki.
    for (const s of ['/main.js', '/preload.cjs', '/../package.json', '/etc/passwd',
      '/..%2Fpackage.json', '/icons/tray-ok.png']) {
      assert.equal((await get(s)).status, 404, s);
    }
  });

  test('nieznana trasa to 404, nie wywrotka', async () => {
    assert.equal((await get('/api/nie-ma-takiej')).status, 404);
  });
});
