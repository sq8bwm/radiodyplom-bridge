// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// N1MM+ — PRAWDZIWY datagram, przechwycony 2026-10-07 z N1MM Logger+ 1.0.11462
// na Windowsie 11 (Config → Configure Ports… → zakładka Broadcast Data,
// zaznaczone „Contacts", log General Logging, QSO zalogowane przyciskiem Log It).
//
// Dekoder `n1mm` nosi jego imię i działa od pierwszego commitu, ale do dziś
// nigdy nie zobaczył bajtów samego N1MM+. Wszystko, co mieliśmy przechwycone
// w tej rodzinie, pochodziło od INNYCH programów mówiących tym protokołem:
// RUMlogNG (02.10), QARTest (05.10), Log4OM (07.10). Rekordy N1MM+ w testach
// były składane przez nas z dokumentacji.
//
// Ten plik to zamyka — i przy okazji utrwala dwie rzeczy zmierzone, a nie
// przyjęte na wiarę:
//
// 1. Jednostka `<txfreq>`: `1420000` przy `<band>14</band>` to 14,2 MHz, czyli
//    dziesiątki herca (setne kHz). Dotąd stało to w komentarzu `n1mm.js` jako
//    zmierzone — ale zmierzone na RUMlogNG, nie na N1MM+. Teraz jest na jednym
//    i drugim.
// 2. XML jest SFORMATOWANY, wcięty TABULATORAMI, z deklaracją `<?xml?>`
//    i złamaniami CRLF. Log4OM robi to samo, tylko spacjami; QARTest i BBLogger
//    wysyłają jedną linię.
//
// Jest tu też `<SentExchange />` — jedyny w naszych zbiorach tag ZAMKNIĘTY
// SAM W SOBIE. Parser tagów musi go przejść, nie krztusząc się na rekordzie.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as n1mm from '../src/decoders/n1mm.js';
import { pickDecoder } from '../src/decoders/index.js';
import { mapToRadiodyplom } from '../src/mapper.js';

// Bajt w bajt z podsłuchu (1581 B). Wcięcia to prawdziwe tabulatory, złamania
// CRLF — stąd join, a nie literał wielolinijkowy.
const QSO = [
  "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
  "<contactinfo>",
  "\t<app>N1MM</app>",
  "\t<contestname>DX</contestname>",
  "\t<dbname>N1MM DXLog.s3db</dbname>",
  "\t<contestnr>0</contestnr>",
  "\t<timestamp>2026-10-07 08:48:27</timestamp>",
  "\t<mycall>SQ8BWM</mycall>",
  "\t<band>14</band>",
  "\t<rxfreq>1420000</rxfreq>",
  "\t<txfreq>1420000</txfreq>",
  "\t<operator>SQ8BWM</operator>",
  "\t<mode>USB</mode>",
  "\t<call>SP9XYZ</call>",
  "\t<countryprefix>SP</countryprefix>",
  "\t<wpxprefix>SP9</wpxprefix>",
  "\t<stationprefix>SQ8BWM</stationprefix>",
  "\t<continent>EU</continent>",
  "\t<snt>59</snt>",
  "\t<sntnr>2</sntnr>",
  "\t<rcv>59</rcv>",
  "\t<rcvnr>0</rcvnr>",
  "\t<gridsquare></gridsquare>",
  "\t<exchange1></exchange1>",
  "\t<section></section>",
  "\t<comment></comment>",
  "\t<qth></qth>",
  "\t<name></name>",
  "\t<power></power>",
  "\t<misctext></misctext>",
  "\t<zone>15</zone>",
  "\t<prec></prec>",
  "\t<ck>0</ck>",
  "\t<ismultiplier1>0</ismultiplier1>",
  "\t<ismultiplier2>0</ismultiplier2>",
  "\t<ismultiplier3>0</ismultiplier3>",
  "\t<points>1</points>",
  "\t<radionr>1</radionr>",
  "\t<run1run2>1</run1run2>",
  "\t<RoverLocation></RoverLocation>",
  "\t<RadioInterfaced>0</RadioInterfaced>",
  "\t<NetworkedCompNr>0</NetworkedCompNr>",
  "\t<IsOriginal>True</IsOriginal>",
  "\t<NetBiosName>DESKTOP-P35FDV1</NetBiosName>",
  "\t<IsRunQSO>0</IsRunQSO>",
  "\t<StationName>DESKTOP-P35FDV1</StationName>",
  "\t<ID>65ba385c74de4adf904276960075534c</ID>",
  "\t<IsClaimedQso>1</IsClaimedQso>",
  "\t<oldtimestamp>2026-10-07 08:48:27</oldtimestamp>",
  "\t<oldcall>SP9XYZ</oldcall>",
  "\t<SentExchange />",
  "\t<CabrilloString>QSO:   14200 PH 2026-10-07 0848 SQ8BWM        59   SP9XYZ        59                                                       </CabrilloString>",
  "</contactinfo>",].join('\r\n');

describe('N1MM Logger+ 1.0.11462', () => {
  test('rozpoznajemy go mimo deklaracji XML i wcięć tabulatorami', () => {
    assert.equal(pickDecoder(Buffer.from(QSO))?.name, 'N1MM');
  });

  test('cały rekord przechodzi mapowanie na pola radiodyplom', () => {
    const { adif } = n1mm.decode(Buffer.from(QSO));
    const wynik = mapToRadiodyplom(adif, 'TEST');
    assert.equal(wynik.ok, true, `brakuje pól wymaganych przez serwer: ${wynik.missing}`);
    const p = wynik.payload;
    assert.equal(p.callsign, 'SP9XYZ');
    assert.equal(p.qso_date, '20261007');
    assert.equal(p.time_on, '084827');
    assert.equal(p.station_callsign, 'SQ8BWM');
    assert.equal(p.operator, 'SQ8BWM');
    assert.equal(p.report_sent, '59');
    assert.equal(p.report_received, '59');
  });

  test('USB to emisja fonii, a nie osobny tryb dla serwera', () => {
    // N1MM+ podaje wstęgę, bo tak pracuje operator. Serwer zna SSB.
    const { adif } = n1mm.decode(Buffer.from(QSO));
    assert.equal(adif.mode, 'SSB');
  });

  test('txfreq N1MM+ to dziesiątki herca — zmierzone na jego własnych bajtach', () => {
    // 1420000 → 14,2 MHz. Odczytane konwencją BBLoggera (dziesiąte kHz) dałoby
    // 142 MHz. To jest ta wartość, na której stoi cała rodzina dekodera —
    // i do dziś opierała się na pomiarze z RUMlogNG, nie z samego N1MM+.
    const { adif } = n1mm.decode(Buffer.from(QSO));
    assert.equal(adif.freq, '14.2');
    assert.equal(adif.band, '20m');
  });

  test('tag zamknięty sam w sobie nie wywraca rekordu', () => {
    // <SentExchange /> — jedyny taki w naszych przechwyconych datagramach.
    // Gdyby parser się na nim zatrzymał, przepadłyby pola PO nim, w tym
    // CabrilloString, ale też sam rekord mógłby wyjść niekompletny.
    assert.ok(QSO.includes('<SentExchange />'), 'literał zgubił tag samozamykający');
    const { adif } = n1mm.decode(Buffer.from(QSO));
    assert.equal(adif.call, 'SP9XYZ');
    assert.equal(adif.operator, 'SQ8BWM');
  });

  test('identyfikator QSO z N1MM+ trafia do klucza deduplikacji', () => {
    // N1MM+ daje <ID> jako GUID bez myślników. Bez niego dwa QSO z tym samym
    // znakiem w tej samej sekundzie skleiłyby się w jedno.
    const { key, meta } = n1mm.decode(Buffer.from(QSO));
    assert.match(key, /^n1mm:65ba385c74de4adf904276960075534c:/);
    assert.equal(meta.app, 'N1MM');
  });
});
