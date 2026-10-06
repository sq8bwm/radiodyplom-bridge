// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// WSJT-X: komunikat „Logged ADIF" (typ 12) obok „QSO Logged" (typ 5).
//
// PO CO: w oknie Network Configuration MSHV ma zaznaczone „Enable Logged QSO
// ADIF" (typ 12), a nie „Enable Logged QSO" (podpowiedź: „Logger32, etc.").
// Do 0.1.38 mostek czytał wyłącznie typ 5, więc takie QSO lądowało w koszu —
// cicho, bo odrzucenie to tylko wpis w logu na poziomie debug.
//
// CZEGO TU NIE MA: datagramu z MSHV. Nie przechwyciliśmy od niego żadnej
// zalogowanej łączności (loguje automatycznie, bez ręcznego zapisu), więc nie
// wiemy, co dokładnie wysyła w którym trybie. Bajty niżej są z WSJT-X.
//
// Oba datagramy niżej pochodzą z JEDNEGO kliknięcia „Log QSO" w WSJT-X 2.7
// na Linuksie, przechwycone na grupie 224.0.0.222:2239. Wklejone bajt w bajt.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as wsjtx from '../src/decoders/wsjtx.js';
import { pickDecoder } from '../src/decoders/index.js';

const TYP5 = Buffer.from(
  'adbccbda00000002000000050000000f57534a542d58202d2053513842574d0000000000'
  + '258e88020143e4010000000753503354455354000000044b4f3131000000000000099a00'
  + '00000346543800000000000000000000000000000000000000000000000000258e880200'
  + '78c4010000000653513842574d0000000653513842574d000000064b4f31314547000000'
  + '0000000000ffffffff000000000000000000000000', 'hex');

const TYP12 = Buffer.from(
  'adbccbda000000020000000c0000000f57534a542d58202d2053513842574d0000012e0a'
  + '3c616469665f7665723a353e332e312e300a3c70726f6772616d69643a363e57534a542d'
  + '580a3c454f483e0a3c63616c6c3a373e53503354455354203c677269647371756172653a'
  + '343e4b4f3131203c6d6f64653a333e465438203c7273745f73656e743a303e203c727374'
  + '5f726376643a303e203c71736f5f646174653a383e3230323631303036203c74696d655f'
  + '6f6e3a363e303931393435203c71736f5f646174655f6f66663a383e3230323631303036'
  + '203c74696d655f6f66663a363e303932303337203c62616e643a303e203c667265713a38'
  + '3e302e303032343538203c73746174696f6e5f63616c6c7369676e3a363e53513842574d'
  + '203c6d795f677269647371756172653a363e4b4f31314547203c6f70657261746f723a36'
  + '3e53513842574d203c454f523e', 'hex');

describe('WSJT-X: Logged ADIF (typ 12)', () => {
  test('typ 12 jest rozpoznawany, a nie odrzucany', () => {
    const r = wsjtx.decode(TYP12);
    assert.ok(r?.adif, `oczekiwałam QSO, dostałam: ${JSON.stringify(r)}`);
    assert.equal(r.adif.call, 'SP3TEST');
  });

  test('nagłówek pliku ADIF jest pomijany', () => {
    // Bez tego parser zatrzyma się na <eoh> i zwróci {adif_ver, programid},
    // czyli wersję formatu zamiast łączności. Sprawdzone na tym datagramie.
    const { adif } = wsjtx.decode(TYP12);
    assert.equal(adif.adif_ver, undefined);
    assert.equal(adif.programid, undefined);
    assert.equal(adif.station_callsign, 'SQ8BWM');
    assert.equal(adif.qso_date, '20261006');
    assert.equal(adif.time_on, '091945');
  });

  test('program nadawcy czytamy z <programid>', () => {
    // Jedyne miejsce w tej rodzinie, gdzie nazwa programu jest w TREŚCI.
    // MSHV wpisze tam swoją — po tym poznamy, co naprawdę nadaje.
    assert.equal(wsjtx.decode(TYP12).meta.program, 'WSJT-X');
  });

  test('ten sam QSO z typu 5 i 12 ma TEN SAM klucz', () => {
    // WSJT-X wysyła oba naraz. Gdyby klucze się różniły, każda łączność
    // poszłaby na serwer DWA RAZY.
    assert.equal(wsjtx.decode(TYP12).key, wsjtx.decode(TYP5).key);
  });

  test('typ 5 nadal działa tak jak działał', () => {
    const { adif } = wsjtx.decode(TYP5);
    assert.equal(adif.call, 'SP3TEST');
    assert.equal(adif.mode, 'FT8');
    assert.equal(adif.station_callsign, 'SQ8BWM');
  });

  test('oba trafiają do dekodera WSJT-X', () => {
    assert.equal(pickDecoder(TYP5)?.name, 'WSJT-X');
    assert.equal(pickDecoder(TYP12)?.name, 'WSJT-X');
  });

  test('inne typy nadal są pomijane, z czytelnym powodem', () => {
    // Heartbeat MSHV — przychodzi co 15 s i nie jest QSO.
    const heartbeat = Buffer.from(
      'adbccbda0000000200000000000000044d5348560000000300000006322e37362e3300000000',
      'hex');
    const r = wsjtx.decode(heartbeat);
    assert.match(r.skip, /typ 0/);
  });
});
