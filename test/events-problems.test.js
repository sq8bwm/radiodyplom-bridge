// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Lista ostatnich zdarzeń i sygnalizacja problemów.
//
// Sygnalizacja problemów ma własny plik testów (problems.test.js), bo wynika
// z zawartości katalogu odrzuconych, a nie z licznika w workerze.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { Worker, EVENT_RING } from '../src/worker.js';
import { setLevel } from '../src/log.js';

setLevel('error');

function fakeStore() {
  return {
    items: [],
    completed: 0,
    failed: 0,
    dryRuns: 0,
    list() { return this.items; },
    complete(_item, opts = {}) {
      this.completed += 1;
      if (opts.dryRun) this.dryRuns += 1;
      this.items = [];
    },
    fail() { this.failed += 1; this.items = []; },
    update() {},
  };
}

/** Klient oddający z góry ustalone odpowiedzi, jedna po drugiej. */
function fakeClient(...replies) {
  let i = 0;
  return { async upload() { return replies[Math.min(i++, replies.length - 1)]; } };
}

function makeItem(call = 'SP7VCL') {
  return {
    key: `k-${call}`, attempts: 0, nextAt: 0,
    payload: { callsign: call, station_callsign: 'SN0LPU', operator: 'SQ8BWM', api_key: 'X' },
    meta: { source: 'qlog' },
  };
}

function makeWorker(client, { maxAttempts = 20 } = {}) {
  return new Worker({
    store: fakeStore(),
    client,
    queue: { maxAttempts, baseDelayMs: 1, maxDelayMs: 2 },
    rateLimit: { maxPerMinute: 1000, minSpacingMs: 0 },
  });
}

describe('bufor ostatnich zdarzeń', () => {
  test('sukces trafia do zdarzeń z listą akcji', async () => {
    const w = makeWorker(fakeClient({ ok: true, savedTo: ['295'] }));
    await w._process(makeItem());
    const e = w.recentEvents().at(-1);
    assert.equal(e.kind, 'sent');
    assert.equal(e.callsign, 'SP7VCL');
    assert.equal(e.station, 'SN0LPU');
    assert.equal(e.operator, 'SQ8BWM');
    assert.deepEqual(e.savedTo, ['295']);
  });

  test('tryb próbny NIE jest oznaczany jako wysłane', async () => {
    // REGRESJA: wiersz „wysłane" bez numeru akcji, przy QSO które nigdy nie
    // opuściło komputera. Dokładnie ten rodzaj mylącego komunikatu, który
    // już raz kosztował nas gubione QSO.
    const w2 = makeWorker(fakeClient({ ok: true, dryRun: true }));
    await w2._process(makeItem());
    assert.equal(w2.recentEvents().at(-1).kind, 'dryrun');
  });

  test('tryb próbny NIE odkłada QSO do odrzuconych', async () => {
    // Sygnalizacja problemów wynika z zawartości failed/, więc przejście
    // próbne nie może tam nic wrzucić — inaczej plakietka świeciłaby
    // po każdym teście mapowania pól.
    const w2 = makeWorker(fakeClient({ ok: true, dryRun: true }));
    await w2._process(makeItem());
    assert.equal(w2.store.failed, 0);
    assert.equal(w2.store.completed, 1);
  });

  test('tryb próbny mówi o tym magazynowi, więc nie wchodzi do „wysłanych"', () => {
    // Sedno: bez przekazania tej flagi licznik trwały rósł przy przejściach
    // próbnych i statystyka twierdziła, że QSO doszło na serwer.
    return (async () => {
      const w2 = makeWorker(fakeClient({ ok: true, dryRun: true }));
      await w2._process(makeItem());
      assert.equal(w2.store.dryRuns, 1);

      const w3 = makeWorker(fakeClient({ ok: true, savedTo: ['295'] }));
      await w3._process(makeItem());
      assert.equal(w3.store.dryRuns, 0, 'prawdziwa wysyłka nie może być liczona jako próbna');
    })();
  });

  test('licznik sesji też nie miesza próbnych z wysłanymi', async () => {
    // Niekonsekwencja wyłapana na żywym ruchu: licznik trwały pomijał próbne,
    // a sesyjny je wliczał — karta mówiła „w tej sesji: 2 kopii" przy
    // „WYSŁANE 0". Dwa liczniki tej samej rzeczy muszą liczyć tak samo.
    const w = makeWorker(fakeClient({ ok: true, dryRun: true }));
    await w._process(makeItem());
    assert.equal(w.counters.dryRun, 1);
    assert.equal(w.counters.sent, 0, 'próbne NIE jest wysłane');

    const w2 = makeWorker(fakeClient({ ok: true, savedTo: ['295'] }));
    await w2._process(makeItem());
    assert.equal(w2.counters.sent, 1);
    assert.equal(w2.counters.dryRun, 0);
  });

  test('duplikat jest osobnym rodzajem, nie sukcesem', async () => {
    const w = makeWorker(fakeClient({ ok: true, duplicate: true }));
    await w._process(makeItem());
    assert.equal(w.recentEvents().at(-1).kind, 'duplicate');
  });

  test('odrzucenie trwałe niesie kod błędu', async () => {
    const w = makeWorker(fakeClient({ ok: false, permanent: true, code: 'NOT_SAVED', error: 'brak akcji' }));
    await w._process(makeItem());
    const e = w.recentEvents().at(-1);
    assert.equal(e.kind, 'rejected');
    assert.equal(e.code, 'NOT_SAVED');
  });

  test('ponowienie też jest zdarzeniem, z numerem próby', async () => {
    const w = makeWorker(fakeClient({ ok: false, permanent: false, error: 'timeout' }));
    await w._process(makeItem());
    const e = w.recentEvents().at(-1);
    assert.equal(e.kind, 'retry');
    assert.equal(e.attempts, 1);
  });

  test('wyczerpanie prób ma własny rodzaj', async () => {
    const w = makeWorker(fakeClient({ ok: false, permanent: false, error: 'sieć' }), { maxAttempts: 1 });
    await w._process(makeItem());
    assert.equal(w.recentEvents().at(-1).kind, 'exhausted');
  });

  test('bufor nie rośnie bez końca', async () => {
    const w = makeWorker(fakeClient({ ok: true }));
    for (let i = 0; i < EVENT_RING + 25; i++) await w._process(makeItem(`SP${i}`));
    assert.equal(w.events.length, EVENT_RING);
    // Zostają NAJNOWSZE, nie najstarsze.
    assert.equal(w.events.at(-1).callsign, `SP${EVENT_RING + 24}`);
  });

  test('recentEvents oddaje żądaną liczbę, najnowsze na końcu', async () => {
    const w = makeWorker(fakeClient({ ok: true }));
    for (let i = 0; i < 10; i++) await w._process(makeItem(`SP${i}`));
    const out = w.recentEvents(3);
    assert.equal(out.length, 3);
    assert.deepEqual(out.map((e) => e.callsign), ['SP7', 'SP8', 'SP9']);
  });

  test('żądanie absurdalnej liczby jest przycinane, nie wywala', async () => {
    const w = makeWorker(fakeClient({ ok: true }));
    await w._process(makeItem());
    assert.equal(w.recentEvents(0).length, 1);
    assert.ok(w.recentEvents(100000).length <= EVENT_RING);
    assert.ok(w.recentEvents('bzdura').length >= 1);
  });
});
