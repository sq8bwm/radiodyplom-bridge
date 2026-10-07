// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// DXLog.net — PRAWDZIWE datagramy, przechwycone 2026-10-07 z DXLog.net v2.6.37
// na Windowsie 11 (log „Casual HF operation", Options → Broadcast → QSOs).
//
// DXLog wymienialiśmy jako obsługiwany od pierwszego commitu, bez żadnego
// pomiaru. Okazuje się, że ma DWA formaty transmisji, przełączane osobną
// pozycją menu `Options → Broadcast → Use N1MM QSO format`, i oba trzeba
// rozumieć, bo użytkownik nie ma powodu domyślać się, że to przełącznik
// cokolwiek dla nas zmienia:
//
//   wyłączone (DOMYŚLNIE) → format własny DXLoga,
//   włączone              → format zgodny z N1MM+.
//
// Oba są XML-em <contactinfo> i oba przechodzą, ale różnią się w dwóch
// miejscach, które mają dla nas znaczenie — i, co ciekawe, każdy jest lepszy
// w czym innym:
//
//   | co            | format własny        | tryb N1MM         |
//   |---------------|----------------------|-------------------|
//   | nazwa programu| <logger>DXLog.net…   | <app>N1MM</app> — podszywa się |
//   | identyfikator | <guid>               | <ID>              |
//
// Przed 07.10 czytaliśmy tylko <ID>, więc format WŁASNY (czyli domyślny!)
// tracił identyfikator i klucz deduplikacji spadał na sam odcisk treści.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as n1mm from '../src/decoders/n1mm.js';
import { pickDecoder } from '../src/decoders/index.js';
import { mapToRadiodyplom } from '../src/mapper.js';

// Format własny DXLoga — 930 B, bajt w bajt z podsłuchu.
const WLASNY = ''
  + "<?xml version=\"1.0\"?><contactinfo><logger>DXLog.net v2.6.37</logger><qsoid>1</qsoid>"
  + "<contestname>DX</contestname><timestamp>2026-10-07 09:09:35</timestamp>"
  + "<mycall>SQ8BWM</mycall><band>1.8</band><txfreq>180000</txfreq><rxfreq>180000</rxfreq>"
  + "<prop_mode></prop_mode><sat_name></sat_name><operator></operator><mode>CW</mode>"
  + "<call>SP5TEST</call><countryprefix>SP</countryprefix><wpxprefix>SP5</wpxprefix>"
  + "<snt>599</snt><rcv>599</rcv><nr>1</nr><exch1></exch1><exch2></exch2><exch3></exch3>"
  + "<exch4></exch4><xqso>False</xqso><invalid>False</invalid><duplicate>False</duplicate>"
  + "<rule10broken>False</rule10broken><azimuth>161</azimuth><distance>15</distance>"
  + "<stationid>STN1</stationid><stationqso>1</stationqso><stationtype>R</stationtype>"
  + "<local>True</local><runqso>True</runqso><mult1>SP</mult1><mult2></mult2><mult3></mult3>"
  + "<points>1</points><period>1</period><guid>b8230f7ec92a46e5b5380888c1d7f57e</guid>"
  + "<newqso>True</newqso></contactinfo>";

// Ten sam program po włączeniu „Use N1MM QSO format" — 1278 B, bajt w bajt.
const TRYB_N1MM = ''
  + "<?xml version=\"1.0\"?><contactinfo><app>N1MM</app><contestname>DX</contestname><dbname>"
  + "</dbname><timestamp>2026-10-07 09:11:01</timestamp><mycall>SQ8BWM</mycall>"
  + "<band>1,8</band><rxfreq>180000</rxfreq><txfreq>180000</txfreq><operator></operator>"
  + "<mode>CW</mode><call>SP9XYZ</call><countryprefix>SP</countryprefix>"
  + "<wpxprefix>SP9</wpxprefix><stationprefix>SP</stationprefix><continent>EU</continent>"
  + "<snt>599</snt><sntnr>2</sntnr><rcv>599</rcv><rcvnr></rcvnr><gridsquare></gridsquare>"
  + "<exchange1></exchange1><section></section><comment></comment><qth></qth><name></name>"
  + "<power></power><misctext></misctext><zone></zone><prec></prec><ck></ck>"
  + "<ismultiplier1>0</ismultiplier1><ismultiplier2>0</ismultiplier2>"
  + "<ismultiplier3>0</ismultiplier3><points>1</points><radionr>1</radionr>"
  + "<run1run2>1</run1run2><RoverLocation></RoverLocation><RadioInterfaced></RadioInterfaced>"
  + "<NetworkedCompNr></NetworkedCompNr><IsOriginal>True</IsOriginal>"
  + "<NetBiosName>DESKTOP-P35FDV1</NetBiosName><IsRunQSO>1</IsRunQSO>"
  + "<StationName>STN1</StationName><ID>64ec9e018f68493cac8f1a4a6e4a9adf</ID>"
  + "<IsClaimedQso>1</IsClaimedQso><oldtimestamp></oldtimestamp><oldcall></oldcall>"
  + "<SentExchange></SentExchange>"
  + "<CabrilloString>QSO:  1800 CW 2026-10-07 0911 SQ8BWM        599 SP9XYZ        599 \r\n</CabrilloString>"
  + "</contactinfo>";

describe('DXLog.net v2.6.37 — format własny (domyślny)', () => {
  test('to zwykły <contactinfo>, więc trafia do dekodera N1MM', () => {
    assert.equal(pickDecoder(Buffer.from(WLASNY))?.name, 'N1MM');
  });

  test('cały rekord przechodzi mapowanie na pola radiodyplom', () => {
    const { adif } = n1mm.decode(Buffer.from(WLASNY));
    const wynik = mapToRadiodyplom(adif, 'TEST');
    assert.equal(wynik.ok, true, `brakuje pól wymaganych przez serwer: ${wynik.missing}`);
    const p = wynik.payload;
    assert.equal(p.callsign, 'SP5TEST');
    assert.equal(p.qso_date, '20261007');
    assert.equal(p.time_on, '090935');
    assert.equal(p.band, '160m');
    assert.equal(p.freq, '1.8');
    assert.equal(p.mode, 'CW');
    assert.equal(p.station_callsign, 'SQ8BWM');
  });

  test('puste <operator> nie zostawia QSO bez operatora', () => {
    // DXLog wypełnia to pole dopiero przy pracy wielostanowiskowej.
    const { adif } = n1mm.decode(Buffer.from(WLASNY));
    assert.equal(adif.operator, 'SQ8BWM');
  });

  test('nazwę programu czytamy z <logger>, bo <app> tu nie ma', () => {
    const { meta } = n1mm.decode(Buffer.from(WLASNY));
    assert.equal(meta.app, 'DXLog.net v2.6.37');
  });

  test('identyfikator bierzemy z <guid>, bo <ID> w tym formacie nie istnieje', () => {
    // To jest ta zmiana z 07.10. Wcześniej klucz wychodził „n1mm:noid:…",
    // czyli opierał się wyłącznie na odcisku treści — a odcisk nie rozróżni
    // dwóch QSO z tym samym znakiem w tej samej sekundzie na tym samym paśmie.
    // DXLog jest programem zawodowym, więc to nie jest przypadek teoretyczny.
    assert.ok(!/<ID>/i.test(WLASNY), 'ten datagram nie powinien mieć <ID>');
    assert.match(WLASNY, /<guid>b8230f7ec92a46e5b5380888c1d7f57e<\/guid>/);
    const { key, meta } = n1mm.decode(Buffer.from(WLASNY));
    assert.equal(meta.id, 'b8230f7ec92a46e5b5380888c1d7f57e');
    assert.match(key, /^n1mm:b8230f7ec92a46e5b5380888c1d7f57e:/);
  });
});

describe('DXLog.net v2.6.37 — po włączeniu „Use N1MM QSO format"', () => {
  test('cały rekord przechodzi mapowanie, tak samo jak format własny', () => {
    const { adif } = n1mm.decode(Buffer.from(TRYB_N1MM));
    const wynik = mapToRadiodyplom(adif, 'TEST');
    assert.equal(wynik.ok, true, `brakuje pól wymaganych przez serwer: ${wynik.missing}`);
    assert.equal(wynik.payload.callsign, 'SP9XYZ');
    assert.equal(wynik.payload.band, '160m');
    assert.equal(wynik.payload.freq, '1.8');
    assert.equal(wynik.payload.mode, 'CW');
  });

  test('w tym trybie DXLog przedstawia się jako N1MM', () => {
    // Nie da się go wtedy odróżnić po <app>. Dla mapowania bez znaczenia,
    // ale w logu mostka zobaczymy „N1MM", a nie DXLoga — stąd ten test:
    // żeby nikt nie uznał tego kiedyś za naszą pomyłkę.
    const { meta } = n1mm.decode(Buffer.from(TRYB_N1MM));
    assert.equal(meta.app, 'N1MM');
    assert.match(meta.id, /^64ec9e018f68493cac8f1a4a6e4a9adf$/);
  });

  test('pasmo z PRZECINKIEM dziesiętnym nie psuje częstotliwości', () => {
    // DXLog w trybie N1MM zapisuje <band> separatorem z ustawień systemu:
    // na polskim Windowsie wychodzi „1,8", a nie „1.8". Number('1,8') to NaN,
    // więc gdyby pasmo liczyło się z tego pola, QSO poszłoby bez pasma.
    // Ratuje nas <txfreq>, z którego liczymy i pasmo, i częstotliwość.
    assert.match(TRYB_N1MM, /<band>1,8<\/band>/, 'literał zgubił przecinek');
    const { adif } = n1mm.decode(Buffer.from(TRYB_N1MM));
    assert.equal(adif.band, '160m');
    assert.equal(adif.freq, '1.8');
  });

  test('złamanie linii w <CabrilloString> nie urywa rekordu', () => {
    // DXLog kończy tam linię CRLF-em, w środku datagramu.
    assert.ok(TRYB_N1MM.includes('\r\n'), 'literał zgubił CRLF');
    const { adif } = n1mm.decode(Buffer.from(TRYB_N1MM));
    assert.equal(adif.call, 'SP9XYZ');
  });
});

describe('separator dziesiętny w <band>', () => {
  // DXLog w trybie N1MM zapisuje pasmo separatorem z ustawień systemu, więc na
  // polskim Windowsie wychodzi „1,8". Przy obecnym <txfreq> nie ma to znaczenia,
  // bo pasmo i częstotliwość liczymy z niego — i tak było w KAŻDYM datagramie,
  // jaki przechwyciliśmy. Te testy pilnują gałęzi awaryjnej: gdyby <txfreq>
  // zabrakło, przecinek kosztowałby pasmo i częstotliwość, i to BEZ ŻADNEGO
  // sygnału — serwer wymaga tylko znaku, daty i znaku stacji, więc przyjąłby
  // takie okrojone QSO bez mrugnięcia.
  const bez = (band) =>
    '<?xml version="1.0"?><contactinfo><app>N1MM</app>'
    + '<timestamp>2026-10-07 09:11:01</timestamp><mycall>SQ8BWM</mycall>'
    + `<band>${band}</band>`
    + '<operator>SQ8BWM</operator><mode>CW</mode><call>SP9XYZ</call>'
    + '<snt>599</snt><rcv>599</rcv></contactinfo>';

  for (const [zapis, mhz, pasmo] of [['1,8', '1.8', '160m'], ['3,5', '3.5', '80m'], ['10,1', '10.1', '30m']]) {
    test(`bez <txfreq> pasmo „${zapis}" czytamy tak samo jak „${mhz}"`, () => {
      const zPrzecinkiem = n1mm.decode(Buffer.from(bez(zapis))).adif;
      const zKropka = n1mm.decode(Buffer.from(bez(mhz))).adif;
      assert.equal(zPrzecinkiem.band, pasmo);
      assert.equal(zPrzecinkiem.freq, mhz);
      assert.deepEqual(zPrzecinkiem, zKropka, 'separator nie może zmieniać wyniku');
    });
  }

  test('to jest cicha strata, a nie odrzucenie — stąd ten test', () => {
    // Dowód, że serwer by się nie poskarżył: rekord BEZ pasma i częstotliwości
    // przechodzi mapowanie. Dlatego przecinka nie wolno zostawić „do wyłapania
    // przez błąd" — żadnego błędu by nie było.
    const { adif } = n1mm.decode(Buffer.from(bez('20m')));
    delete adif.band;
    const wynik = mapToRadiodyplom(adif, 'TEST');
    assert.equal(wynik.ok, true);
    assert.equal(wynik.payload.band, undefined);
    assert.equal(wynik.payload.freq, undefined);
  });

  test('nazwa pasma ADIF nadal działa — zamiana nie psuje „20m"', () => {
    const { adif } = n1mm.decode(Buffer.from(bez('20m')));
    assert.equal(adif.band, '20m');
  });
});
