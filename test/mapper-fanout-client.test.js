// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Mapowanie na format radiodyplom, rozmnażanie QSO i klasyfikacja odpowiedzi API.
// Tu siedzą najgroźniejsze z dzisiejszych błędów: ciche gubienie QSO.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { mapToRadiodyplom } from '../src/mapper.js';
import { expandTargets, targetEnabled } from '../src/fanout.js';
import { RadiodyplomClient } from '../src/radiodyplom.js';
import { computeState, maskPin } from '../src/httpapi.js';
import { setLevel } from '../src/log.js';

setLevel('error');

const ADIF = {
  call: 'sp9xyz', qso_date: '20260831', time_on: '101500',
  band: '40m', mode: 'ssb', rst_sent: '59', rst_rcvd: '59',
  station_callsign: 'sq8bwm', operator: 'sp9log', freq: '7.140', comment: 'x',
};

describe('mapToRadiodyplom', () => {
  test('znaki i emisja idą wielkimi literami', () => {
    const { payload } = mapToRadiodyplom(ADIF, 'PIN');
    assert.equal(payload.callsign, 'SP9XYZ');
    assert.equal(payload.station_callsign, 'SQ8BWM');
    assert.equal(payload.operator, 'SP9LOG');
    assert.equal(payload.mode, 'SSB');
  });

  // REGRESJA: pasmo było podnoszone do wielkich liter i wychodziło "40M",
  // a konwencja ADIF (i radiodyplom) to "40m".
  test('pasmo zostaje małymi literami', () => {
    assert.equal(mapToRadiodyplom(ADIF, 'PIN').payload.band, '40m');
  });

  test('brak pola wymaganego = odrzucenie z listą braków', () => {
    const r = mapToRadiodyplom({ ...ADIF, station_callsign: '' }, 'PIN');
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing, ['station_callsign']);
  });

  test('puste pola opcjonalne nie są wysyłane', () => {
    const { payload } = mapToRadiodyplom({ ...ADIF, comment: '   ' }, 'PIN');
    assert.ok(!('comment' in payload));
  });

  test('PIN trafia do ładunku', () => {
    assert.equal(mapToRadiodyplom(ADIF, 'ABCD-1234').payload.api_key, 'ABCD-1234');
  });
});

describe('expandTargets (rozmnażanie QSO)', () => {
  const base = mapToRadiodyplom(ADIF, 'GLOWNY').payload;

  test('brak celów = jedno QSO, bez zmian', () => {
    const out = expandTargets(base, [], 'k');
    assert.equal(out.length, 1);
    assert.equal(out[0].key, 'k');
    assert.equal(out[0].payload.station_callsign, 'SQ8BWM');
  });

  // REGRESJA: bez znaku stacji w kluczu wszystkie kopie miały ten sam klucz
  // i deduplikacja przepuszczała TYLKO PIERWSZĄ — dwie ciche straty.
  test('każda kopia ma inny klucz', () => {
    const out = expandTargets(base, [
      { station_callsign: 'SP1AAA' }, { station_callsign: 'SP2BBB' }, { station_callsign: 'SP3CCC' },
    ], 'k');
    const keys = out.map((o) => o.key);
    assert.equal(new Set(keys).size, 3);
    assert.deepEqual(keys, ['k|SP1AAA', 'k|SP2BBB', 'k|SP3CCC']);
  });

  test('cel bez operatora zachowuje operatora z loggera', () => {
    const [c] = expandTargets(base, [{ station_callsign: 'SP1AAA' }], 'k');
    assert.equal(c.payload.operator, 'SP9LOG');
  });

  test('cel z operatorem nadpisuje go, ale NIE znakiem stacji', () => {
    const [c] = expandTargets(base, [{ station_callsign: 'SP1AAA', operator: 'SP1OP' }], 'k');
    assert.equal(c.payload.operator, 'SP1OP');
    assert.equal(c.payload.station_callsign, 'SP1AAA');
  });

  test('własny PIN celu wygrywa nad głównym', () => {
    const [a, b] = expandTargets(base, [
      { station_callsign: 'SP1AAA' },
      { station_callsign: 'SP2BBB', pin: 'INNY-PIN' },
    ], 'k');
    assert.equal(a.payload.api_key, 'GLOWNY');
    assert.equal(b.payload.api_key, 'INNY-PIN');
  });

  test('cel bez znaku stacji i powtórzony znak są pomijane', () => {
    const out = expandTargets(base, [
      { station_callsign: '' }, { station_callsign: 'SP1AAA' }, { station_callsign: 'sp1aaa' },
    ], 'k');
    assert.equal(out.length, 1);
  });

  test('pozostałe pola kopii są nietknięte (m.in. freq)', () => {
    const [c] = expandTargets(base, [{ station_callsign: 'SP1AAA' }], 'k');
    assert.equal(c.payload.freq, '7.140');
    assert.equal(c.payload.callsign, 'SP9XYZ');
    assert.equal(c.payload.band, '40m');
  });
});

describe('RadiodyplomClient — klasyfikacja odpowiedzi', () => {
  const realFetch = globalThis.fetch;
  let client;

  beforeEach(() => {
    client = new RadiodyplomClient({ apiUrl: 'http://x/api', pin: 'PIN', timeoutMs: 500 });
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  const respond = (body, status = 200) => {
    globalThis.fetch = async () => ({ status, json: async () => body });
  };

  test('savedTo z akcjami = sukces', async () => {
    respond({ success: true, savedTo: [295], errors: [] });
    const r = await client.upload({ callsign: 'X' });
    assert.equal(r.ok, true);
    assert.deepEqual(r.savedTo, [295]);
  });

  // REGRESJA (najgroźniejsza): serwer odpowiada success:true z PUSTYM savedTo,
  // gdy znak stacji nie ma uprawnień. Uznanie tego za sukces = QSO ginie
  // bez żadnego sygnału.
  test('success:true z pustym savedTo to BŁĄD, nie sukces', async () => {
    respond({ success: true, savedTo: [], message: 'brak uprawnień' });
    const r = await client.upload({ callsign: 'X' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'NOT_SAVED');
    assert.equal(r.permanent, true, 'ponawianie tu nic nie da');
  });

  // REGRESJA: klasyfikacja działała po liście znanych kodów trwałych,
  // więc nieznany INVALID_CALLSIGN był ponawiany 20 razy przez godziny.
  test('nieznany kod błędu jest domyślnie TRWAŁY', async () => {
    respond({ success: false, error: { code: 'INVALID_CALLSIGN', message: 'zły znak' } });
    const r = await client.upload({ callsign: 'X' });
    assert.equal(r.ok, false);
    assert.equal(r.permanent, true);
    assert.equal(r.code, 'INVALID_CALLSIGN');
  });

  test('limit tempa jest przejściowy, więc ponawiamy', async () => {
    respond({ success: false, error: { code: 'RATE_LIMIT', message: 'zbyt wiele żądań' } });
    const r = await client.upload({ callsign: 'X' });
    assert.equal(r.permanent, false);
  });

  test('duplikat traktujemy jak sukces (wysyłka idempotentna)', async () => {
    respond({ success: false, error: { code: 'DUPLICATE_QSO', message: 'duplikat' } });
    const r = await client.upload({ callsign: 'X' });
    assert.equal(r.ok, true);
    assert.equal(r.duplicate, true);
  });

  test('5xx i 429 są przejściowe', async () => {
    for (const status of [500, 502, 429]) {
      respond({}, status);
      const r = await client.upload({ callsign: 'X' });
      assert.equal(r.ok, false);
      assert.equal(r.permanent, false, `HTTP ${status} ma być przejściowy`);
    }
  });

  test('awaria sieci jest przejściowa', async () => {
    globalThis.fetch = async () => { throw new Error('fetch failed'); };
    const r = await client.upload({ callsign: 'X' });
    assert.equal(r.permanent, false);
  });

  test('tryb próbny nie wykonuje żadnego żądania', async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; return { status: 200, json: async () => ({}) }; };
    const dry = new RadiodyplomClient({ apiUrl: 'http://x', pin: 'P', dryRun: true });
    const r = await dry.upload({ callsign: 'X' });
    assert.equal(r.ok, true);
    assert.equal(called, false, 'dry-run nie może dotknąć sieci');
  });

  test('PIN z ładunku wygrywa nad PIN-em klienta (fan-out do innej akcji)', async () => {
    let seen = null;
    globalThis.fetch = async (_u, o) => {
      seen = JSON.parse(o.body);
      return { status: 200, json: async () => ({ success: true, savedTo: [1] }) };
    };
    await client.upload({ callsign: 'X', api_key: 'CEL-PIN' });
    assert.equal(seen.api_key, 'CEL-PIN');
  });

  // --- PING: opis konta (rozszerzenie API z 2026-09-04) ---

  test('PING oddaje listę stacji i akcji, znaki wielkimi literami', async () => {
    globalThis.fetch = async () => ({ status: 200, json: async () => ({
      success: true, operator: 'SQ8BWM', stations: [' sn8n ', 'sq8bwa'],
      activeActions: [{ id: 295, name: 'Muzeum' }], pinExpires: null, apiEnabled: true,
    }) });
    const p = await client.ping();
    assert.equal(p.ok, true);
    assert.deepEqual(p.stations, ['SN8N', 'SQ8BWA'], 'porównanie ze znakiem celu musi być pewne');
    assert.equal(p.activeActions.length, 1);
    assert.equal(p.apiEnabled, true);
  });

  test('starszy serwis: brak pól daje null, a NIE pustą listę', async () => {
    // Zlanie tych przypadków kazałoby ostrzegać przed poprawną konfiguracją
    // na każdym serwerze bez tego rozszerzenia.
    globalThis.fetch = async () => ({ status: 200, json: async () => ({
      success: true, operator: 'SQ8BWM',
    }) });
    const p = await client.ping();
    assert.equal(p.stations, null);
    assert.equal(p.activeActions, null);
    assert.equal(p.apiEnabled, null);
  });

  test('PING można zadać INNYM kluczem niż własny (PIN celu)', async () => {
    let url = null;
    globalThis.fetch = async (u) => { url = String(u); return { status: 200, json: async () => ({ success: true, operator: 'SQ8BWA' }) }; };
    const p = await client.ping('CEL-PIN');
    assert.match(url, /api_key=CEL-PIN/);
    assert.equal(p.operator, 'SQ8BWA');
  });

  test('odrzucony klucz niesie KOD, nie tylko tekst', async () => {
    // Bez kodu nie da się odróżnić złego PIN-u od awarii sieci, a to dwie
    // różne rzeczy do pokazania użytkownikowi.
    globalThis.fetch = async () => ({ status: 401, json: async () => ({
      success: false, error: { code: 'INVALID_API_KEY', message: 'Nieprawidłowy klucz' },
    }) });
    const p = await client.ping();
    assert.equal(p.ok, false);
    assert.equal(p.code, 'INVALID_API_KEY');
  });

  test('awaria sieci przy PING-u nie ma kodu', async () => {
    globalThis.fetch = async () => { throw new Error('timeout'); };
    const p = await client.ping();
    assert.equal(p.ok, false);
    assert.equal(p.code, undefined);
  });
});

describe('computeState — jedno źródło stanu dla okna i zasobnika', () => {
  test('wstrzymanie ma pierwszeństwo', () => {
    assert.equal(computeState({ paused: true, online: false, failed: 3, pingOk: false }).state, 'warn');
  });

  test('brak łączności (PING albo realny POST) daje błąd', () => {
    assert.equal(computeState({ paused: false, online: true, failed: 0, pingOk: false }).state, 'error');
    assert.equal(computeState({ paused: false, online: false, failed: 0, pingOk: true }).state, 'error');
  });

  test('odrzucone QSO to ostrzeżenie, nie brak łączności', () => {
    assert.equal(computeState({ paused: false, online: true, failed: 2, pingOk: true }).state, 'warn');
  });

  test('wszystko sprawne', () => {
    assert.equal(computeState({ paused: false, online: true, failed: 0, pingOk: true }).state, 'ok');
  });
});

describe('maskPin', () => {
  test('nigdy nie zwraca pełnego PIN-u', () => {
    for (const pin of ['AAAA-1111', 'BBBB-2222', 'ABCDEFGH', 'ab']) {
      const m = maskPin(pin);
      assert.ok(!m.includes(pin.split('-')[1] ?? pin.slice(-4)) || m.includes('*'),
        `maska ${m} nie może ujawniać ${pin}`);
      assert.ok(m.includes('*'), `maska ${m} musi zawierać gwiazdki`);
    }
  });

  test('zachowuje pierwszy segment, żeby dało się rozpoznać PIN', () => {
    assert.equal(maskPin('AAAA-1111'), 'AAAA-****');
  });

  test('brak PIN-u daje null', () => {
    assert.equal(maskPin(null), null);
    assert.equal(maskPin(''), null);
  });
});

describe('znacznik włączenia celu', () => {
  const PAYLOAD = {
    api_key: 'GLOWNY', callsign: 'SP7VCL', station_callsign: 'SQ8BWM',
    band: '80m', mode: 'SSB', qso_date: '20260903', time_on: '100000',
  };

  test('brak pola = reguła włączona', () => {
    assert.equal(targetEnabled({ station_callsign: 'X' }), true);
    assert.equal(targetEnabled({ station_callsign: 'X', enabled: true }), true);
    assert.equal(targetEnabled({ station_callsign: 'X', enabled: false }), false);
  });

  test('wyłączona reguła nie tworzy kopii', () => {
    const copies = expandTargets(PAYLOAD, [
      { station_callsign: 'SN0LPU' },
      { station_callsign: 'SN8N', enabled: false },
    ], 'k');
    assert.deepEqual(copies.map((c) => c.station), ['SN0LPU']);
  });

  test('WSZYSTKIE wyłączone = jak brak celów, a nie brak wysyłki', () => {
    // Najważniejsze w tym znaczniku: wyłączenie wszystkiego nie może
    // oznaczać, że QSO przepada. Leci jedno, ze stacją z loggera.
    const copies = expandTargets(PAYLOAD, [
      { station_callsign: 'SN0LPU', enabled: false },
      { station_callsign: 'SN8N', enabled: false },
    ], 'k');
    assert.equal(copies.length, 1);
    assert.equal(copies[0].station, 'SQ8BWM', 'stacja z loggera, nie z wyłączonego celu');
    assert.equal(copies[0].key, 'k', 'klucz bez przyrostka — to nie jest kopia');
  });

  test('wyłączona reguła nie blokuje znaku dla innej', () => {
    // Odrzucanie duplikatów stacji liczy tylko reguły czynne.
    const copies = expandTargets(PAYLOAD, [
      { station_callsign: 'SN8N', enabled: false, operator: 'STARY' },
      { station_callsign: 'SN8N', operator: 'NOWY' },
    ], 'k');
    assert.equal(copies.length, 1);
    assert.equal(copies[0].payload.operator, 'NOWY');
  });

  test('PIN wyłączonej reguły nie jest używany', () => {
    const copies = expandTargets(PAYLOAD, [
      { station_callsign: 'SN8N', pin: 'CUDZY-1', enabled: false },
      { station_callsign: 'SN0LPU' },
    ], 'k');
    assert.equal(copies.length, 1);
    assert.equal(copies[0].payload.api_key, 'GLOWNY');
  });
});
