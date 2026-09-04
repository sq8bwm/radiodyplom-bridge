// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Sprawdzanie, czy jest nowsze wydanie.
//
// Program NIE aktualizuje się sam — to wyłącznie powiadomienie. Testy pilnują
// trzech rzeczy, na których łatwo się przejechać:
//   1. porównanie wersji SKŁADOWYMI, nie tekstem („0.1.9" < „0.1.10" to false),
//   2. brak łączności ma być CICHY — nie wolno z niego robić problemu,
//   3. śmieci w odpowiedzi nie mogą wywołać fałszywego „jest nowsza wersja".
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { compareVersions, isNewer, repoFromUrl, checkLatest } from '../src/updates.js';
import { setLevel } from '../src/log.js';

setLevel('error');

describe('porównanie wersji', () => {
  test('0.1.10 jest nowsze niż 0.1.9 — pułapka porównania tekstowego', () => {
    // REGRESJA-W-ZARODKU: '0.1.9' < '0.1.10' daje w JS false, więc po wydaniu
    // 0.1.10 program uznałby, że 0.1.9 jest nowsze. Nasza własna numeracja
    // weszła w ten przypadek 2026-09-04.
    assert.ok('0.1.9' > '0.1.10', 'tekstowo 0.1.9 wypada większe — to jest ta pułapka');
    assert.equal(isNewer('0.1.10', '0.1.9'), true);
    assert.equal(isNewer('0.1.9', '0.1.10'), false);
  });

  test('kolejne przypadki graniczne', () => {
    assert.ok(compareVersions('1.0.0', '0.9.9') > 0);
    assert.ok(compareVersions('0.2.0', '0.1.99') > 0);
    assert.equal(compareVersions('0.1.10', '0.1.10'), 0);
    assert.equal(compareVersions('v0.1.10', '0.1.10'), 0, 'przedrostek v bez znaczenia');
    assert.equal(compareVersions('0.1', '0.1.0'), 0, 'brakująca składowa to zero');
    assert.ok(compareVersions('0.1.1', '0.1') > 0);
  });

  test('równa wersja to NIE aktualizacja', () => {
    assert.equal(isNewer('0.1.10', '0.1.10'), false);
    assert.equal(isNewer('v0.1.10', '0.1.10'), false);
  });

  test('śmieci nie dają fałszywego „jest nowsza"', () => {
    for (const s of ['', null, undefined, 'najnowsza', '0.1.x', 'wersja 2']) {
      assert.equal(isNewer(s, '0.1.10'), false, `latest=${s}`);
      assert.equal(isNewer('0.1.11', s), false, `current=${s}`);
    }
  });
});

describe('repoFromUrl', () => {
  test('wyciąga właściciela i nazwę', () => {
    assert.equal(repoFromUrl('https://github.com/sq8bwm/radiodyplom-bridge'), 'sq8bwm/radiodyplom-bridge');
    assert.equal(repoFromUrl('git+https://github.com/sq8bwm/radiodyplom-bridge.git'), 'sq8bwm/radiodyplom-bridge');
    assert.equal(repoFromUrl('git@github.com:sq8bwm/radiodyplom-bridge.git'), 'sq8bwm/radiodyplom-bridge');
  });

  test('obcy adres i śmieci dają null', () => {
    assert.equal(repoFromUrl('https://gitlab.com/kto/co'), null);
    assert.equal(repoFromUrl(''), null);
    assert.equal(repoFromUrl(undefined), null);
  });
});

/** Podstawiony fetch oddający zadaną odpowiedź. */
const fakeFetch = (body, { ok = true, status = 200 } = {}) => async () => ({
  ok, status, json: async () => body,
});

describe('checkLatest', () => {
  const repo = 'sq8bwm/radiodyplom-bridge';

  test('nowsze wydanie', async () => {
    const r = await checkLatest({ repo, current: '0.1.9',
      fetchImpl: fakeFetch({ tag_name: 'v0.1.10', html_url: 'https://x/rel' }) });
    assert.equal(r.ok, true);
    assert.equal(r.latest, '0.1.10', 'przedrostek v obcięty');
    assert.equal(r.newer, true);
    assert.equal(r.url, 'https://x/rel');
  });

  test('ta sama wersja — nic do zrobienia', async () => {
    const r = await checkLatest({ repo, current: '0.1.10',
      fetchImpl: fakeFetch({ tag_name: 'v0.1.10' }) });
    assert.equal(r.ok, true);
    assert.equal(r.newer, false);
  });

  test('brak łączności jest CICHY — ok:false, ale bez wyjątku', async () => {
    // Sedno: przy PING-u nauczyliśmy się, że robienie problemu z chwilowej
    // awarii sieci kłamie użytkownikowi. Tu tym bardziej — to tylko wygoda.
    const r = await checkLatest({ repo, current: '0.1.10',
      fetchImpl: async () => { throw new Error('fetch failed'); } });
    assert.equal(r.ok, false);
    assert.match(r.error, /fetch failed/);
    assert.ok(r.checkedAt, 'wiadomo KIEDY nie wyszło');
  });

  test('HTTP 404 (brak wydań) nie wywala', async () => {
    const r = await checkLatest({ repo, current: '0.1.10',
      fetchImpl: fakeFetch({}, { ok: false, status: 404 }) });
    assert.equal(r.ok, false);
    assert.match(r.error, /404/);
  });

  test('odpowiedź bez tag_name nie udaje wydania', async () => {
    const r = await checkLatest({ repo, current: '0.1.10', fetchImpl: fakeFetch({ cokolwiek: 1 }) });
    assert.equal(r.ok, false);
  });

  test('połamany JSON nie przewraca sprawdzania', async () => {
    const r = await checkLatest({ repo, current: '0.1.10',
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('zły JSON'); } }) });
    assert.equal(r.ok, false);
  });

  test('brak repozytorium w package.json — nie pytamy w próżnię', async () => {
    let wolane = false;
    const r = await checkLatest({ repo: null, current: '0.1.10',
      fetchImpl: async () => { wolane = true; return fakeFetch({})(); } });
    assert.equal(r.ok, false);
    assert.equal(wolane, false, 'żadnego żądania bez adresu repozytorium');
  });

  test('pyta pod właściwy adres i nie wysyła nic o użytkowniku', async () => {
    let url = null; let opcje = null;
    await checkLatest({ repo, current: '0.1.10',
      fetchImpl: async (u, o) => { url = u; opcje = o; return fakeFetch({ tag_name: 'v0.1.10' })(); } });
    assert.equal(url, `https://api.github.com/repos/${repo}/releases/latest`);
    // Żadnych ciasteczek, tokenów ani niczego, co identyfikowałoby maszynę.
    assert.deepEqual(Object.keys(opcje.headers), ['Accept']);
  });
});
