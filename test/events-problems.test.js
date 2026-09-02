// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Lista ostatnich zdarzeń i sygnalizacja problemów.
//
// Sens sygnalizacji: QSO bywa odrzucane przy zamkniętym oknie. Licznik musi
// więc żyć w rdzeniu i trwać, aż użytkownik go potwierdzi — inaczej
// informacja „coś nie doszło" przepada razem z oknem.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { Worker, EVENT_RING } from '../src/worker.js';
import { setLevel } from '../src/log.js';

setLevel('error');

function fakeStore() {
  return {
    items: [],
    list() { return this.items; },
    complete() { this.items = []; },
    fail() { this.items = []; },
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

  test('tryb próbny nie zapala sygnalizacji problemów', async () => {
    const w2 = makeWorker(fakeClient({ ok: true, dryRun: true }));
    await w2._process(makeItem());
    assert.equal(w2.problems.count, 0);
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

describe('sygnalizacja problemów', () => {
  let w;
  beforeEach(() => { w = makeWorker(fakeClient({ ok: true })); });

  test('sukces nie zapala sygnalizacji', async () => {
    await w._process(makeItem());
    assert.equal(w.problems.count, 0);
  });

  test('duplikat też nie — to nie jest problem', async () => {
    const d = makeWorker(fakeClient({ ok: true, duplicate: true }));
    await d._process(makeItem());
    assert.equal(d.problems.count, 0);
  });

  test('ponowienie NIE jest problemem – naprawia się samo', async () => {
    const r = makeWorker(fakeClient({ ok: false, permanent: false, error: 'timeout' }));
    await r._process(makeItem());
    assert.equal(r.problems.count, 0, 'inaczej plakietka świeciłaby przy każdym mignięciu sieci');
  });

  test('odrzucenie trwałe zapala i pamięta szczegóły', async () => {
    const b = makeWorker(fakeClient({ ok: false, permanent: true, code: 'NOT_SAVED', error: 'brak akcji' }));
    await b._process(makeItem('SP1AAA'));
    assert.equal(b.problems.count, 1);
    assert.equal(b.problems.last.code, 'NOT_SAVED');
    assert.equal(b.problems.last.callsign, 'SP1AAA');
    assert.ok(b.problems.firstAt);
    assert.ok(b.problems.lastAt);
  });

  test('wyczerpanie prób też zapala', async () => {
    const b = makeWorker(fakeClient({ ok: false, permanent: false, error: 'sieć' }), { maxAttempts: 1 });
    await b._process(makeItem());
    assert.equal(b.problems.count, 1);
  });

  test('kolejne problemy zwiększają licznik, pierwsza chwila się nie zmienia', async () => {
    const b = makeWorker(fakeClient({ ok: false, permanent: true, code: 'NOT_SAVED', error: 'x' }));
    await b._process(makeItem('SP1AAA'));
    const first = b.problems.firstAt;
    await b._process(makeItem('SP2BBB'));
    assert.equal(b.problems.count, 2);
    assert.equal(b.problems.firstAt, first);
    assert.equal(b.problems.last.callsign, 'SP2BBB');
  });

  test('potwierdzenie kasuje sygnalizację i zwraca, ile jej było', async () => {
    const b = makeWorker(fakeClient({ ok: false, permanent: true, code: 'NOT_SAVED', error: 'x' }));
    await b._process(makeItem('SP1AAA'));
    await b._process(makeItem('SP2BBB'));
    assert.equal(b.ackProblems(), 2);
    assert.equal(b.problems.count, 0);
    assert.equal(b.problems.last, null);
  });

  test('potwierdzenie NIE czyści listy zdarzeń', async () => {
    // Zdarzenia to historia; sygnalizacja to wezwanie do działania.
    const b = makeWorker(fakeClient({ ok: false, permanent: true, code: 'NOT_SAVED', error: 'x' }));
    await b._process(makeItem());
    b.ackProblems();
    assert.equal(b.recentEvents().length, 1);
  });

  test('po potwierdzeniu nowy problem zapala od nowa', async () => {
    const b = makeWorker(fakeClient({ ok: false, permanent: true, code: 'NOT_SAVED', error: 'x' }));
    await b._process(makeItem('SP1AAA'));
    b.ackProblems();
    await b._process(makeItem('SP2BBB'));
    assert.equal(b.problems.count, 1);
  });
});
