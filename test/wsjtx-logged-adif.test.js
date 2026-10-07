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
// Oba datagramy niżej pochodzą z JEDNEGO kliknięcia „Log QSO" w WSJT-X improved
// 3.1.0 (DG2YCB) — NIE w mainlinowym WSJT-X 2.7, jak stało tu do 07.10.2026.
//
// Sprostowanie z pomiaru: pakiet `wsjtx` na tej maszynie ma Maintainer
// dg2ycb@gmx.de i wersję 3.1.0 (mainline ma numerację 2.7.x), a w binarce są
// `actionWSJT_X_improved_Home_Page` i adres wsjt-x-improved.sourceforge.io.
// Binarka jest z 2026-02-25, czyli to ona zrobiła te bajty 2026-10-06.
//
// Co to zmienia: mainlinowego WSJT-X NIE MAMY przechwyconego ani razu. Protokół
// UDP improved dziedziczy po mainlinie i niemal na pewno jest identyczny — ale
// „niemal na pewno" to nie pomiar, więc nie wolno tego pisać jako faktu.
// na Linuksie, przechwycone na grupie 224.0.0.222:2239. Wklejone bajt w bajt.
//
// WAŻNE DLA WARTOŚCI DOWODOWEJ TYCH BAJTÓW: maszyna, na której powstały, ma
// `LC_NUMERIC="pl_PL.UTF-8"` (w /etc/locale.conf i w środowisku sesji, więc
// programy z pulpitu to dziedziczą). Pod tym ustawieniem biblioteka C pisze
// liczby PRZECINKIEM. Mimo to pole FREQ w obu rekordach ma KROPKĘ — i to jest
// pomiar, nie przypadek: rodzina WSJT-X nie przepuszcza locale do ADIF-a,
// w przeciwieństwie do N1MM+, który na polskim Windowsie wysyła <band>1,8</band>
// (patrz n1mm-plus.test.js). Bez tej adnotacji te bajty nie dowodziłyby niczego.
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

// ===== PRAWDZIWE QSO Z MSHV 2.76.3, przechwycone 2026-10-06 =====
//
// Jedna łączność FT4 wysłana przez MSHV DWOMA komunikatami naraz (w oknie
// Network Configuration zaznaczone były oba przełączniki). To ten przypadek,
// który omal nie wprowadził podwójnych QSO: MSHV opisuje tę samą łączność
// RÓŻNIE w obu komunikatach —
//
//   typ 5  → MODE=FT4,  BAND=20m   (pasmo liczone z częstotliwości)
//   typ 12 → MODE=MFSK, SUBMODE=FT4, BAND=20M
//
// bo ADIF trzyma FT4 jako podtyp MFSK, a MSHV pisze pasmo wielkimi literami.
// Bez ujednolicenia emisji i pasma odciski treści się różniły i ta sama
// łączność poszłaby na serwer dwa razy.
const MSHV_TYP5 = Buffer.from(
  'adbccbda0000000200000005000000044d5348560000000000258e8802330ca001000000'
  + '06535138415a54000000000000000000d6d80000000003465434000000032b3032000000'
  + '032b30350000000000000000000000000000000000258e88023222400100000000000000'
  + '06535138425741000000064b4f3131454700000000000000000000000000000000000000'
  + '0000000000', 'hex');

const MSHV_TYP12 = Buffer.from(
  'adbccbda000000020000000c000000044d5348560000012c0a3c414449465f5645523a35'
  + '3e332e312e300a3c50524f4752414d49443a343e4d5348560a3c454f483e0a3c53544154'
  + '494f4e5f43414c4c5349474e3a363e5351384257413c4d595f475249445351554152453a'
  + '363e4b4f313145473c43414c4c3a363e535138415a543c475249445351554152453a303e'
  + '3c44495354414e43453a303e3c4d4f44453a343e4d46534b3c5355424d4f44453a333e46'
  + '54343c5253545f53454e543a333e2b30323c5253545f524356443a333e2b30353c51534f'
  + '5f444154453a383e32303236313030363c54494d455f4f4e3a363e3130313430303c5153'
  + '4f5f444154455f4f46463a383e32303236313030363c54494d455f4f46463a363e313031'
  + '3530303c42414e443a333e32304d3c465245513a393e31342e3038303030303c454f523e', 'hex');

describe('MSHV: jedna łączność, dwa komunikaty', () => {
  test('oba opisują to samo QSO', () => {
    const a = wsjtx.decode(MSHV_TYP5).adif;
    const b = wsjtx.decode(MSHV_TYP12).adif;
    assert.equal(a.call, 'SQ8AZT');
    assert.equal(b.call, 'SQ8AZT');
    assert.equal(a.time_on, b.time_on);
  });

  test('FT4 nie gubi się jako „MFSK"', () => {
    // ADIF: MODE=MFSK + SUBMODE=FT4. Wysłanie samego „MFSK" na serwer znaczy
    // tyle, co nic — operator pracował FT4 i tak ma być w logu akcji.
    assert.equal(wsjtx.decode(MSHV_TYP12).adif.mode, 'FT4');
    assert.equal(wsjtx.decode(MSHV_TYP5).adif.mode, 'FT4');
  });

  test('pasmo zapisane jednakowo, małymi literami', () => {
    assert.equal(wsjtx.decode(MSHV_TYP12).adif.band, '20m');
    assert.equal(wsjtx.decode(MSHV_TYP5).adif.band, '20m');
  });

  test('TEN SAM klucz — inaczej jedno QSO poszłoby dwa razy', () => {
    assert.equal(wsjtx.decode(MSHV_TYP12).key, wsjtx.decode(MSHV_TYP5).key);
  });

  test('po programie nadawcy poznajemy MSHV', () => {
    assert.equal(wsjtx.decode(MSHV_TYP12).meta.program, 'MSHV');
    assert.equal(wsjtx.decode(MSHV_TYP5).meta.client, 'MSHV');
  });

  test('surowe SUBMODE nie wycieka dalej', () => {
    // Serwer go nie zna, a zostawione obok znormalizowanej emisji myliłoby
    // przy czytaniu zgłoszeń.
    assert.equal(wsjtx.decode(MSHV_TYP12).adif.submode, undefined);
  });
});
