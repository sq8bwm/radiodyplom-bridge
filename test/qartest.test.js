// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// QARTest — PRAWDZIWY datagram, przechwycony 2026-10-05 z QARTest 16.9.1
// na Windowsie 11 (log DXPedition, Options → External data broadcast, QSO).
//
// Do tego dnia nasza dokumentacja wymieniała QARTest wśród NIEOBSŁUGIWANYCH,
// z adnotacją „własny, odrębny protokół (9458)". Twierdzenie pochodziło
// z pierwszego commitu (31 sierpnia) i nikt go nigdy nie sprawdził — a jest
// nieprawdziwe: QARTest wysyła zwykły XML <contactinfo>, który rozumiemy od
// początku. Program przeszedł całą drogę BEZ żadnej zmiany w kodzie.
//
// Ten plik istnieje po to, żeby tego faktu nie trzeba było znowu odkrywać.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as n1mm from '../src/decoders/n1mm.js';
import { pickDecoder } from '../src/decoders/index.js';
import { mapToRadiodyplom } from '../src/mapper.js';

// Wklejone bajt w bajt z podsłuchu, razem z CRLF na końcu.
const QSO = '<?xml version="1.0"?><contactinfo><logger>QARTest 16.9.1</logger>'
  + '<contestname>XXXXXXXXXX</contestname><timestamp>2026-10-05 19:27:29</timestamp>'
  + '<mycall>SQ8BWM</mycall><band>160</band><txfreq>180000</txfreq><operator></operator>'
  + '<mode>LSB</mode><call>SN0TEST</call><countryprefix>SP</countryprefix>'
  + '<wpxprefix>SN0</wpxprefix><snt>59</snt><rcv>59</rcv><nr>1</nr><exch1></exch1>'
  + '<exch2>59</exch2><exch3></exch3><duplicate>False</duplicate><stationname></stationname>'
  + '<points>0</points><xqso>0</xqso><id>72E032A6</id></contactinfo>\r\n';

describe('QARTest 16.9.1', () => {
  test('trafia do dekodera N1MM, a nie do „nieznanych"', () => {
    assert.equal(pickDecoder(Buffer.from(QSO))?.name, 'N1MM');
  });

  test('cały rekord przechodzi mapowanie na pola radiodyplom', () => {
    const { adif } = n1mm.decode(Buffer.from(QSO));
    const wynik = mapToRadiodyplom(adif, 'TEST');
    assert.equal(wynik.ok, true, `brakuje pól wymaganych przez serwer: ${wynik.missing}`);
    const p = wynik.payload;
    assert.equal(p.callsign, 'SN0TEST');
    assert.equal(p.qso_date, '20261005');
    assert.equal(p.time_on, '192729');
    assert.equal(p.band, '160m');
    assert.equal(p.freq, '1.8');
    assert.equal(p.mode, 'SSB', 'LSB to emisja fonii, a nie osobny tryb dla serwera');
    assert.equal(p.station_callsign, 'SQ8BWM');
  });

  test('puste <operator> nie zostawia QSO bez operatora', () => {
    // QARTest wypełnia <operator> dopiero przy pracy wielostanowiskowej.
    // Bez zapasu z <mycall> QSO szłoby na serwer bez znaku operatora.
    const { adif } = n1mm.decode(Buffer.from(QSO));
    assert.equal(adif.operator, 'SQ8BWM');
  });

  test('pasmo liczymy z częstotliwości, bo <band> to gołe metry', () => {
    // U N1MM+ <band> to MHz-y („14"), u BBLoggera nazwa ADIF („20m"),
    // a tu metry jako liczba („160"). Jedyne wspólne źródło prawdy to txfreq.
    const { adif } = n1mm.decode(Buffer.from(QSO));
    assert.equal(adif.band, '160m');
    assert.equal(adif.freq, '1.8');
  });

  test('identyfikator QSO z QARTesta trafia do klucza deduplikacji', () => {
    // Bez niego dwa QSO z tym samym znakiem w tej samej minucie mogłyby się
    // skleić w jedno — a w zawodach to się zdarza.
    const { key } = n1mm.decode(Buffer.from(QSO));
    assert.match(key, /^n1mm:72E032A6:/);
  });

  test('po programie nadawcy poznajemy QARTest, choć <app> jest puste', () => {
    // UWAGA: to jest tylko to, ZA CO PROGRAM SIĘ PODAJE. RUMlogNG wpisuje
    // w <app> „N1MM", bo celowo udaje N1MM-a — więc pole nadaje się do diagnozy,
    // a nie do rozpoznawania nadawcy.
    const { meta } = n1mm.decode(Buffer.from(QSO));
    assert.equal(meta.app, 'QARTest 16.9.1');
  });

  test('nazwa programu trafia do wpisu w logu, ale NIE do nawiasu ze źródłem', () => {
    // import-log.js odtwarza historię z logów i czyta źródło z nawiasu
    // kwadratowego. Dopisek w nawiasie rozsypałby statystyki wstecz.
    const zrodlo = readFileSync(new URL('../src/daemon.js', import.meta.url), 'utf8');
    const linia = zrodlo.slice(zrodlo.indexOf('Nowe QSO ['), zrodlo.indexOf('Nowe QSO [') + 400);
    assert.match(linia, /program: item\.meta\.app/, 'program ma być w części opisowej');
    assert.doesNotMatch(linia.slice(0, linia.indexOf('`,')), /meta\.app/, 'i NIE w samym komunikacie');
  });
});
