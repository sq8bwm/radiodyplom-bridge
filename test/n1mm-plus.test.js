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

describe('<rxfreq> jako zapas, gdy nie ma <txfreq>', () => {
  // N1MM+, DXLog (oba formaty) i RUMlogNG wysyłają OBA pola; Log4OM i QARTest
  // tylko <txfreq> (sprawdzone na przechwyconych datagramach 07.10). Trzeciego
  // pola częstotliwości w tej rodzinie nie ma — żadnego <freq>.
  //
  // Łączność opisuje częstotliwość NADAWANIA, więc <txfreq> ma pierwszeństwo.
  // <rxfreq> wchodzi dopiero, gdy go zabraknie: przy simpleksie jest identyczny,
  // przy splicie różni się o kilka kHz i leży w tym samym paśmie — czyli jest
  // nieporównanie lepszy niż zejście do samego <band>, które daje zaokrąglenie
  // do pełnych MHz, a przy przecinku dziesiętnym nie daje nic.
  const rekord = ({ tx, rx }) =>
    '<?xml version="1.0"?><contactinfo><app>N1MM</app>'
    + '<timestamp>2026-10-07 09:11:01</timestamp><mycall>SQ8BWM</mycall><band>14</band>'
    + (tx == null ? '' : `<txfreq>${tx}</txfreq>`)
    + (rx == null ? '' : `<rxfreq>${rx}</rxfreq>`)
    + '<operator>SQ8BWM</operator><mode>CW</mode><call>SP9XYZ</call>'
    + '<snt>599</snt><rcv>599</rcv></contactinfo>';

  test('prawdziwy datagram N1MM+ ma oba pola i bierzemy z niego nadawanie', () => {
    assert.match(QSO, /<rxfreq>1420000<\/rxfreq>/);
    assert.match(QSO, /<txfreq>1420000<\/txfreq>/);
    assert.equal(n1mm.decode(Buffer.from(QSO)).adif.freq, '14.2');
  });

  test('przy splicie wygrywa <txfreq>, bo to ono opisuje łączność', () => {
    const { adif } = n1mm.decode(Buffer.from(rekord({ tx: '1425000', rx: '1425500' })));
    assert.equal(adif.freq, '14.25', 'wzięte zostało nasłuchiwanie zamiast nadawania');
  });

  test('bez <txfreq> bierzemy <rxfreq>, zamiast schodzić do <band>', () => {
    // Bez tego zapasu wynik to 14 MHz z <band> — pasmo by się zgadzało,
    // ale częstotliwość byłaby zmyślona co do 250 kHz.
    const { adif } = n1mm.decode(Buffer.from(rekord({ tx: null, rx: '1425000' })));
    assert.equal(adif.freq, '14.25');
    assert.equal(adif.band, '20m');
  });

  test('<txfreq> zerowe traktujemy jak brak', () => {
    // N1MM wpisuje 0, gdy nie ma podłączonego radia i nie ustawiono częstotliwości.
    const { adif } = n1mm.decode(Buffer.from(rekord({ tx: '0', rx: '1425000' })));
    assert.equal(adif.freq, '14.25');
  });

  test('bez obu pól zostaje <band> — zachowanie bez zmian', () => {
    const { adif } = n1mm.decode(Buffer.from(rekord({ tx: null, rx: null })));
    assert.equal(adif.band, '20m');
    assert.equal(adif.freq, '14');
  });
});

// Drugi PRAWDZIWY datagram N1MM+, przechwycony 2026-10-07 — to samo uruchomienie,
// ale QSO na 160 m. Istnieje po to, żeby odpowiedzieć na jedno pytanie, którego
// datagram z 14 MHz rozstrzygnąć NIE MÓGŁ: 14 to liczba całkowita, więc separator
// dziesiętny w ogóle się w niej nie pojawia.
//
// Odpowiedź: N1MM+ zapisuje `<band>1,8</band>` — PRZECINKIEM, z ustawień systemu.
// To nie jest dziwactwo DXLoga, tylko zachowanie samego N1MM na zlokalizowanym
// Windowsie. Zmierzone na polskim Windowsie 11; ten sam komputer, ta sama chwila:
//
//   N1MM+ 1.0.11462          <band>1,8</band>   przecinek
//   DXLog, tryb N1MM         <band>1,8</band>   przecinek
//   DXLog, format własny     <band>1.8</band>   kropka
//   Log4OM 2.41.0.0          <band>1.8</band>   kropka
//
// Czyli separator zależy od IMPLEMENTACJI, a nie od protokołu — i akurat dwa
// najpopularniejsze programy zawodowe są po stronie przecinka.
const QSO_160M = [
  "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
  "<contactinfo>",
  "\t<app>N1MM</app>",
  "\t<contestname>DX</contestname>",
  "\t<dbname>N1MM DXLog.s3db</dbname>",
  "\t<contestnr>0</contestnr>",
  "\t<timestamp>2026-10-07 09:36:51</timestamp>",
  "\t<mycall>SQ8BWM</mycall>",
  "\t<band>1,8</band>",
  "\t<rxfreq>180000</rxfreq>",
  "\t<txfreq>180000</txfreq>",
  "\t<operator>SQ8BWM</operator>",
  "\t<mode>LSB</mode>",
  "\t<call>SP1BAND</call>",
  "\t<countryprefix>SP</countryprefix>",
  "\t<wpxprefix>SP1</wpxprefix>",
  "\t<stationprefix>SQ8BWM</stationprefix>",
  "\t<continent>EU</continent>",
  "\t<snt>59</snt>",
  "\t<sntnr>3</sntnr>",
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
  "\t<ismultiplier1>1</ismultiplier1>",
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
  "\t<ID>235699dc0b1a457bb02926d430aa8ff1</ID>",
  "\t<IsClaimedQso>1</IsClaimedQso>",
  "\t<oldtimestamp>2026-10-07 09:36:51</oldtimestamp>",
  "\t<oldcall>SP1BAND</oldcall>",
  "\t<SentExchange />",
  "\t<CabrilloString>QSO:    1800 PH 2026-10-07 0936 SQ8BWM        59   SP1BAND       59                                                       </CabrilloString>",
  "</contactinfo>",].join('\r\n');

describe('N1MM+ na 160 m — separator dziesiętny w <band>', () => {
  test('N1MM+ zapisuje pasmo PRZECINKIEM, tak jak DXLog w trybie N1MM', () => {
    assert.match(QSO_160M, /<band>1,8<\/band>/,
      'to jest cały powód istnienia tego datagramu w testach');
  });

  test('mimo przecinka pasmo i częstotliwość wychodzą poprawnie', () => {
    // Bo liczymy je z <txfreq>, który jest liczbą całkowitą w jednostkach 10 Hz
    // i żaden separator się w nim nie pojawia — niezależnie od wersji językowej.
    const { adif } = n1mm.decode(Buffer.from(QSO_160M));
    assert.equal(adif.band, '160m');
    assert.equal(adif.freq, '1.8');
    assert.equal(adif.call, 'SP1BAND');
    assert.equal(adif.mode, 'SSB', 'LSB to wstęga, serwer zna emisję');
  });

  test('cały rekord przechodzi mapowanie', () => {
    const { adif } = n1mm.decode(Buffer.from(QSO_160M));
    const wynik = mapToRadiodyplom(adif, 'TEST');
    assert.equal(wynik.ok, true, `brakuje pól: ${wynik.missing}`);
    assert.equal(wynik.payload.band, '160m');
  });
});
