// Worker: PIN rozstrzygany przy wysyłce, na podstawie operatora QSO.
//
// Dlaczego to ma osobne testy: PIN decyduje, na czyje konto trafi łączność,
// a operator spoza bazy nie objawia się błędem serwera — QSO po prostu nie
// zostaje zapisane. Odrzucamy je więc lokalnie, ale MUSI dać się je odzyskać
// po dopisaniu operatora, bez restartu programu.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { Worker } from '../src/worker.js';
import { NO_OPERATOR_PIN } from '../src/operators.js';
import { setLevel } from '../src/log.js';

setLevel('error');

const BOOK = [
  { call: 'SQ8BWM', name: 'Marek', pin: 'MAREK-1111' },
  { call: 'SP4OIK', pin: 'AGA-2222' },
];

/** Atrapa kolejki: trzyma jeden element i notuje, co się z nim stało. */
function fakeStore(item) {
  return {
    items: [item],
    failed: [],
    completed: [],
    list() { return this.items; },
    complete(i) { this.completed.push(i); this.items = []; },
    fail(i, markSeen) { this.failed.push({ item: i, markSeen }); this.items = []; },
    update() {},
  };
}

/** Atrapa klienta: notuje PIN każdego żądania i zawsze potwierdza zapis. */
function fakeClient() {
  return {
    calls: [],
    async upload(payload) {
      this.calls.push({ api_key: payload.api_key, operator: payload.operator });
      return { ok: true, savedTo: ['295'] };
    },
  };
}

function makeItem({ operator, pinExplicit = false, api_key = 'GLOWNY-0000' }) {
  return {
    key: 'k1', attempts: 0, nextAt: 0,
    payload: { callsign: 'SP7VCL', station_callsign: 'SN0ABC', operator, api_key },
    meta: { source: 'qlog', pinExplicit },
  };
}

function makeWorker(store, client, { operators = BOOK, profile = 'SQ8BWM' } = {}) {
  return new Worker({
    store,
    client,
    queue: { maxAttempts: 20, baseDelayMs: 1, maxDelayMs: 2 },
    rateLimit: { maxPerMinute: 60, minSpacingMs: 0 },
    operators,
    getProfile: () => profile,
  });
}

describe('PIN z bazy przy wysyłce', () => {
  let client;
  beforeEach(() => { client = fakeClient(); });

  test('QSO operatora z bazy leci JEGO PIN-em', async () => {
    const store = fakeStore(makeItem({ operator: 'SP4OIK' }));
    await makeWorker(store, client)._process(store.items[0]);
    assert.equal(client.calls[0].api_key, 'AGA-2222');
    assert.equal(store.completed.length, 1);
  });

  test('QSO bez operatora leci PIN-em głównym', async () => {
    const store = fakeStore(makeItem({ operator: '' }));
    await makeWorker(store, client)._process(store.items[0]);
    assert.equal(client.calls[0].api_key, 'GLOWNY-0000');
  });

  test('QSO właściciela PIN-u głównego leci PIN-em głównym', async () => {
    // SQ8BWM jest w bazie, ale to jego własny profil – i tak ma być spójnie.
    const store = fakeStore(makeItem({ operator: 'SQ8BWM' }));
    await makeWorker(store, client, { operators: [] })._process(store.items[0]);
    assert.equal(client.calls[0].api_key, 'GLOWNY-0000');
  });

  test('PIN wpisany wprost w cel nie jest nadpisywany przez bazę', async () => {
    const store = fakeStore(makeItem({ operator: 'SP4OIK', pinExplicit: true, api_key: 'WPROST-9' }));
    await makeWorker(store, client)._process(store.items[0]);
    assert.equal(client.calls[0].api_key, 'WPROST-9');
  });
});

describe('operator spoza bazy', () => {
  test('QSO NIE jest wysyłane i ląduje w odrzuconych z własnym kodem', async () => {
    const client = fakeClient();
    const store = fakeStore(makeItem({ operator: 'SP9ZZZ' }));
    await makeWorker(store, client)._process(store.items[0]);

    assert.equal(client.calls.length, 0, 'nie wolno marnować wysyłki');
    assert.equal(store.failed.length, 1);
    assert.equal(store.failed[0].item.lastErrorCode, NO_OPERATOR_PIN);
    assert.match(store.failed[0].item.lastError, /SP9ZZZ/);
    // REGRESJA: oznaczenie klucza jako obsłużonego zamykało drogę powrotną —
    // „Ponów odrzucone" pomija wszystko, co jest w `seen`, więc QSO było
    // nie do odzyskania. Nie wysłaliśmy go, więc nie wolno go zamykać.
    assert.equal(store.failed[0].markSeen, false, 'klucz musi zostać wolny');
  });

  test('odrzucenie nie zużywa limitu wysyłek', async () => {
    // Limit to 9/min i jest wspólny dla wszystkich QSO. Lokalne odrzucenie
    // nie wysyła nic, więc nie może blokować sąsiednich łączności.
    const client = fakeClient();
    const store = fakeStore(makeItem({ operator: 'SP9ZZZ' }));
    const w = makeWorker(store, client);
    await w._process(store.items[0]);
    assert.equal(w.window.length, 0);
  });

  test('odrzucenie nie gasi wskaźnika łączności', async () => {
    // To problem z danymi, nie z siecią – „brak połączenia" byłby mylący.
    const client = fakeClient();
    const store = fakeStore(makeItem({ operator: 'SP9ZZZ' }));
    const w = makeWorker(store, client);
    await w._process(store.items[0]);
    assert.equal(w.online, true);
  });

  test('po dopisaniu operatora do bazy to samo QSO przechodzi', async () => {
    // NAJWAŻNIEJSZY test: rozstrzygnięcie musi być liczone przy każdej próbie,
    // a nie zapamiętane w elemencie kolejki. Inaczej „Ponów odrzucone"
    // wracałoby z tym samym błędem i QSO byłoby nie do odzyskania.
    const client = fakeClient();
    const item = makeItem({ operator: 'SP9ZZZ' });
    const store = fakeStore(item);
    const w = makeWorker(store, client);

    await w._process(item);
    assert.equal(store.failed.length, 1, 'najpierw odrzucone');

    // użytkownik dopisuje operatora i klika „Ponów odrzucone"
    w.operators = [...BOOK, { call: 'SP9ZZZ', pin: 'ZZZ-3333' }];
    store.items = [item];
    await w._process(item);

    assert.equal(client.calls.length, 1, 'teraz wysłane');
    assert.equal(client.calls[0].api_key, 'ZZZ-3333');
  });
});
