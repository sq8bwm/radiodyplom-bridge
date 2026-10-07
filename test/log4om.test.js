// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Log4OM 2 — PRAWDZIWY datagram, przechwycony 2026-10-07 z Log4OM 2 na
// Windowsie 11 (Settings → Software integration → UDP inbound/outbound,
// „N1MM compatible", QSO zalogowane ręcznie na 14,074 MHz).
//
// Log4OM wymienialiśmy jako obsługiwany od dawna — ale wyłącznie na podstawie
// jego dokumentacji, nigdy z podsłuchu. Ten plik zamyka tę lukę, a przy okazji
// utrwala trzy rzeczy, których żaden inny przechwycony datagram nie pokazuje.
//
// 1. XML jest SFORMATOWANY: deklaracja `<?xml?>`, złamania linii CRLF i wcięcia
//    po dwie spacje. QARTest i BBLogger wysyłają wszystko w jednej linii, więc
//    nasz dekoder nigdy nie dostał rekordu z białymi znakami między tagami.
// 2. `<txfreq>1407400</txfreq>` jest w jednostkach 10 Hz (konwencja N1MM+),
//    a `<band>14</band>` to MHz-y jako goła liczba. Uwaga: „14" NIE jest nazwą
//    pasma ADIF, więc rozstrzygania jednostki przez pasmo tu nie ma — ratuje
//    nas domyślny przelicznik. Gdyby Log4OM należał do rodziny BBLoggera
//    (dziesiąte kHz), ta sama liczba dałaby 140,74 MHz i nikt by nie zauważył.
// 3. Taga `<operator>` NIE MA WCALE (nie jest pusty — nie istnieje) i nie ma
//    też `<id>`. Pierwsze sprawdza zapas z `<mycall>`, drugie — klucz
//    deduplikacji liczony z treści.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as n1mm from '../src/decoders/n1mm.js';
import { pickDecoder } from '../src/decoders/index.js';
import { mapToRadiodyplom } from '../src/mapper.js';

// Bajt w bajt z podsłuchu (434 B). Łamania linii są CRLF — stąd join, a nie
// zwykły literał wielolinijkowy, który dałby same LF-y i zgubił różnicę.
const QSO = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<contactinfo>',
  '  <app>LOG4OM2</app>',
  '  <timestamp>2026-10-07 08:05:40</timestamp>',
  '  <mycall>SQ8BWM</mycall>',
  '  <band>14</band>',
  '  <txfreq>1407400</txfreq>',
  '  <mode>FT8</mode>',
  '  <call>SP5TEST</call>',
  '  <stationprefix>SP5</stationprefix>',
  '  <continent>EU</continent>',
  '  <snt>+00</snt>',
  '  <rcv>+00</rcv>',
  '  <gridsquare>KO02</gridsquare>',
  '  <power>100.0</power>',
  '  <zone>15</zone>',
  '</contactinfo>',
].join('\r\n');

describe('Log4OM 2', () => {
  test('rozpoznajemy go mimo deklaracji XML i złamań linii przed treścią', () => {
    // Rozpoznawanie patrzy na początek datagramu, a tu przed <contactinfo>
    // stoi deklaracja i CRLF. U QARTesta i BBLoggera nie ma tam niczego.
    assert.equal(pickDecoder(Buffer.from(QSO))?.name, 'N1MM');
  });

  test('cały rekord przechodzi mapowanie na pola radiodyplom', () => {
    const { adif } = n1mm.decode(Buffer.from(QSO));
    const wynik = mapToRadiodyplom(adif, 'TEST');
    assert.equal(wynik.ok, true, `brakuje pól wymaganych przez serwer: ${wynik.missing}`);
    const p = wynik.payload;
    assert.equal(p.callsign, 'SP5TEST');
    assert.equal(p.qso_date, '20261007');
    assert.equal(p.time_on, '080540');
    assert.equal(p.mode, 'FT8');
    assert.equal(p.station_callsign, 'SQ8BWM');
    assert.equal(p.gridsquare, 'KO02');
    assert.equal(p.report_sent, '+00');
    assert.equal(p.report_received, '+00');
  });

  test('txfreq z Log4OM liczymy w jednostkach 10 Hz, jak u N1MM+', () => {
    // Ten datagram przypisuje Log4OM do rodziny N1MM+, a nie BBLoggera —
    // i to jedyny dowód, jaki mamy. Odczytany konwencją BBLoggera (dziesiąte
    // kHz) dałby 140,74 MHz, czyli pasmo spoza planu amatorskiego.
    //
    // Nie rozstrzyga tego sąsiednie <band>14</band>: „14" to MHz-y jako liczba,
    // a nie nazwa pasma ADIF, więc czyNazwaPasma() ją odrzuca i gałąź
    // rozpoznawania jednostki po paśmie się nie uruchamia. Działa przelicznik
    // domyślny — dlatego ta wartość musi być zabita testem.
    const { adif } = n1mm.decode(Buffer.from(QSO));
    assert.equal(adif.freq, '14.074');
    assert.equal(adif.band, '20m');
  });

  test('brak taga <operator> nie zostawia QSO bez operatora', () => {
    // Log4OM nie wysyła tego pola w ogóle. Serwer wymaga operatora, więc bez
    // zapasu z <mycall> rekord nie przeszedłby mapowania.
    const { adif } = n1mm.decode(Buffer.from(QSO));
    assert.equal(adif.operator, 'SQ8BWM');
  });

  test('bez <id> klucz deduplikacji liczymy z treści QSO', () => {
    // QARTest daje <id>, Log4OM nie. Gdyby klucz był wtedy stały, dwa różne
    // QSO z Log4OM zlałyby się w jedno i drugie przepadłoby jako duplikat.
    const { key } = n1mm.decode(Buffer.from(QSO));
    assert.match(key, /^n1mm:noid:[0-9a-f]+$/);

    const inne = QSO.replace('SP5TEST', 'SP9ABC');
    assert.notEqual(n1mm.decode(Buffer.from(inne)).key, key);
  });

  test('program podajemy z <app>, żeby było widać w logu, co przysłało QSO', () => {
    const { meta } = n1mm.decode(Buffer.from(QSO));
    assert.equal(meta.app, 'LOG4OM2');
  });
});
