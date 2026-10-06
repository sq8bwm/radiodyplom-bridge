// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Ponowienie przy INVALID_MODE: to serwer decyduje, czego nie obsługuje.
//
// SKĄD TO SIĘ WZIĘŁO. Zmierzone 2026-10-06: radiodyplom.pl waliduje emisje
// i odrzuca nieznane TRWALE (`INVALID_MODE`), a odrzucone QSO ląduje w failed/
// i do dyplomu nie trafia wcale. Przyjmuje m.in. FT4, C4FM, PSK31, DIGI, NXDN;
// odrzuca JS8 i Q65.
//
// Łączność JS8 przychodzi z loggera jako MODE=MFSK + SUBMODE=JS8. Gdybyśmy
// wysłali sam podtyp i poprzestali — QSO przepadłoby, mimo że jako MFSK
// zostałoby przyjęte. Gdybyśmy z góry pomijali „nieobsługiwane" podtypy
// według listy wpisanej w kod — decydowalibyśmy za serwis, a lista
// zestarzałaby się przy pierwszej zmianie u nich.
//
// Rozwiązanie: wysyłamy WIERNIE to, co podał logger, a dopiero odmowa serwera
// każe nam cofnąć się do rodziny. Nie zgadujemy niczego.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Worker } from '../src/worker.js';
import { setLevel } from '../src/log.js';

setLevel('error');

function fakeStore() {
  return {
    items: [], failed: 0, completed: 0, aktualizacje: 0,
    list() { return this.items; },
    complete() { this.completed += 1; this.items = []; },
    fail() { this.failed += 1; this.items = []; },
    update() { this.aktualizacje += 1; },
  };
}

/** Klient oddający kolejne odpowiedzi i zapamiętujący, co dostał. */
function klient(...odpowiedzi) {
  const wyslane = [];
  let i = 0;
  return {
    wyslane,
    async upload(payload) {
      wyslane.push({ ...payload });
      return odpowiedzi[Math.min(i++, odpowiedzi.length - 1)];
    },
  };
}

const ODMOWA = {
  ok: false, permanent: true, code: 'INVALID_MODE',
  error: 'Nieprawidłowa lub nieobsługiwana emisja (mode/submode): JS8',
};

function qso({ mode = 'JS8', modeRodzina = 'MFSK' } = {}) {
  return {
    key: 'k-1', attempts: 0, nextAt: 0,
    payload: { callsign: 'SP9ABC', station_callsign: 'SQ8BWM', mode, api_key: 'X' },
    meta: { source: 'QLog', modeRodzina },
  };
}

function worker(c, store = fakeStore()) {
  return [new Worker({
    store, client: c,
    queue: { maxAttempts: 20, baseDelayMs: 1, maxDelayMs: 2 },
    rateLimit: { maxPerMinute: 1000, minSpacingMs: 0 },
  }), store];
}

describe('serwer odmawia emisji, wracamy do rodziny', () => {
  test('po INVALID_MODE QSO NIE ląduje w failed/, tylko czeka na ponowienie', async () => {
    const c = klient(ODMOWA);
    const [w, store] = worker(c);
    const item = qso();
    await w._process(item);
    assert.equal(store.failed, 0, 'QSO nie może przepaść — da się je jeszcze wysłać');
    assert.equal(item.payload.mode, 'MFSK', 'emisja cofnięta do rodziny z rekordu loggera');
  });

  test('ponowienie naprawdę dochodzi do serwera', async () => {
    const c = klient(ODMOWA, { ok: true, savedTo: ['338'] });
    const [w, store] = worker(c);
    const item = qso();
    await w._process(item);   // odmowa → zamiana emisji
    await w._process(item);   // druga próba
    assert.deepEqual(c.wyslane.map((p) => p.mode), ['JS8', 'MFSK']);
    assert.equal(store.completed, 1);
  });

  test('bez zapasu odrzucenie zostaje odrzuceniem', async () => {
    // Logger podał samo MFSK — nie ma czego podstawić, więc nie udajemy,
    // że da się to uratować.
    const c = klient(ODMOWA);
    const [w, store] = worker(c);
    await w._process(qso({ mode: 'MFSK', modeRodzina: undefined }));
    assert.equal(store.failed, 1);
  });

  test('nie zapętlamy się, gdy serwer odmawia także rodzinie', async () => {
    const c = klient(ODMOWA);
    const [w, store] = worker(c);
    const item = qso();
    await w._process(item);   // JS8 → MFSK
    await w._process(item);   // MFSK też odrzucone: payload.mode === modeRodzina
    assert.equal(store.failed, 1, 'drugie odrzucenie musi być ostateczne');
    assert.deepEqual(c.wyslane.map((p) => p.mode), ['JS8', 'MFSK']);
  });

  test('inne odrzucenia trwałe nie są ruszane', async () => {
    // Zamiana emisji nie naprawi braku znaku stacji — i nie wolno udawać,
    // że naprawi, bo QSO krążyłoby w kolejce.
    const c = klient({ ok: false, permanent: true, code: 'INVALID_QSO_DATA', error: 'brak station_callsign' });
    const [w, store] = worker(c);
    const item = qso();
    await w._process(item);
    assert.equal(store.failed, 1);
    assert.equal(item.payload.mode, 'JS8', 'emisji nie ruszamy');
  });

  test('zdarzenie jest widoczne, a nie ciche', async () => {
    // Cisza przy podmianie danych to dokładnie to, co dziś tropiliśmy cały dzień.
    const c = klient(ODMOWA);
    const [w] = worker(c);
    await w._process(qso());
    const e = w.recentEvents().at(-1);
    assert.equal(e.kind, 'retry-mode');
  });
});
