// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// ADIF przysłany DATAGRAMEM UDP — droga, którą chodzi BBLogger.
//
// Dekoder ADIF-a powstał dla Logger32, który łączy się po TCP, i w komentarzu
// obok niego od początku stało, że „ten sam ADIF przyjmiemy też datagramem UDP".
// Nikt tego nigdy nie sprawdził: WSZYSTKIE testy ADIF-a szły po TCP.
//
// Sprawdzam to teraz, bo na tym zdaniu stoi obsługa BBLoggera. Instrukcja jego
// autorów (podłączenie do platformy HamAward, aribusto.it) mówi wprost:
//
//   „Nel campo UDP 1 … IP/Host 127.0.0.1 e Porta 12060. Il formato ADIF va benissimo."
//
// czyli BBLogger wysyła ADIF na UDP 12060 — ten sam port, który mamy domyślnie.
//
// W samym programie lista `Format` ma OBA: `ADIF` i `XML (N1MM)` — obejrzane
// 05.10.2026. XML N1MM mamy przetestowany od dawna; ADIF po UDP dopiero tutaj,
// bo wszystkie dotychczasowe testy ADIF-a szły po TCP. W materiałach autorów
// BBLoggera słowo N1MM nie pada ani razu — stąd nasz dawny wpis był mylący.
//
// UWAGA: poniższy rekord jest ZŁOŻONY PRZEZ NAS według opisu formatu, a nie
// przechwycony z BBLoggera. Dowodzi, że ADIF po UDP w ogóle przechodzi — nie
// dowodzi, że BBLogger wysyła dokładnie takie pola.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';

import { LoggerListener } from '../src/udp.js';
import { QsoPipeline } from '../src/qso-pipeline.js';
import * as dekoderAdif from '../src/decoders/logger32.js';
import * as dekoderN1mm from '../src/decoders/n1mm.js';
import { setLevel } from '../src/log.js';
import { wolnyPortUdp } from './pomoc-porty.js';

setLevel('error');

const QSO = '<call:6>SP9XYZ<qso_date:8>20261005<time_on:6>101500<band:3>40m'
  + '<mode:3>SSB<station_callsign:6>SQ8BWM<freq:5>7.140<rst_sent:2>59<rst_rcvd:2>59<eor>';

describe('ADIF datagramem UDP (droga BBLoggera)', () => {
  const zamykacze = [];
  after(async () => { for (const f of zamykacze) await f(); });

  async function nasluch() {
    const odebrane = [];
    const pipeline = new QsoPipeline({
      operations: ['insert'], pin: 'TEST', targets: [],
      onQSO: (item) => odebrane.push(item),
    });
    const port = await wolnyPortUdp();
    const l = new LoggerListener({ host: '127.0.0.1', port, pipeline });
    await l.start();
    zamykacze.push(() => l.stop());
    return { port, odebrane, pipeline };
  }

  function wyslij(port, dane) {
    return new Promise((gotowe, blad) => {
      const s = dgram.createSocket('udp4');
      s.send(Buffer.from(dane), port, '127.0.0.1', (err) => {
        s.close();
        err ? blad(err) : gotowe();
      });
    });
  }

  const chwila = () => new Promise((r) => setTimeout(r, 80));

  test('rekord ADIF w datagramie przechodzi tak samo jak po TCP', async () => {
    const { port, odebrane } = await nasluch();
    await wyslij(port, QSO);
    await chwila();

    assert.equal(odebrane.length, 1, 'ADIF po UDP miał zostać rozpoznany');
    assert.equal(odebrane[0].payload.callsign, 'SP9XYZ');
    assert.equal(odebrane[0].payload.band, '40m');
    assert.equal(odebrane[0].payload.station_callsign, 'SQ8BWM');
  });

  test('źródło podpisane jest dekoderem ADIF, nie nazwą cudzego programu', async () => {
    // Celowo przez `dekoderAdif.name`, a nie przez wpisany tu napis: test ma
    // pilnować, że źródłem jest TEN dekoder, a nie jak się akurat nazywa.
    const { port, odebrane } = await nasluch();
    await wyslij(port, QSO);
    await chwila();
    assert.equal(odebrane[0].meta.source, dekoderAdif.name);
  });

  test('liczniki widzą to jako normalne QSO', async () => {
    const { port, pipeline } = await nasluch();
    await wyslij(port, QSO);
    await chwila();
    assert.equal(pipeline.stats.accepted, 1);
    assert.equal(pipeline.stats.bySource[dekoderAdif.name], 1);
  });

  test('nagłówek pliku ADIF w datagramie nie jest QSO', async () => {
    // BBLogger wysyła pojedyncze rekordy, ale gdyby ktoś przesłał plik,
    // sam nagłówek nie ma prawa policzyć się jako łączność.
    const { port, odebrane, pipeline } = await nasluch();
    await wyslij(port, 'Wygenerowane przez BBLogger<adif_ver:5>3.1.4<programid:8>BBLogger<eoh>');
    await chwila();
    assert.equal(odebrane.length, 0);
    assert.equal(pipeline.stats.accepted, 0);
  });
});

// ===== PRAWDZIWE datagramy z BBLoggera 14.7, przechwycone 2026-10-05 =====
//
// Jedno QSO wysłane do nas DWIEMA drogami naraz (BBLogger ma trzy gniazda UDP):
// UDP 1 w formacie ADIF, UDP 2 w formacie XML (N1MM). Wklejone bajt w bajt
// z podsłuchu — to one są dowodem na obsługę tego programu, nie nasze wyobrażenie
// o formacie. Różnica między nimi wyłapała prawdziwy błąd, patrz niżej.
const BBL_ADIF = '<CALL:7>SN1TEST <QSO_DATE:8>20261005 <TIME_ON:6>125817 '
  + '<QSO_DATE_OFF:8>20261005 <TIME_OFF:6>125917 <MODE:3>SSB <BAND:3>20m <COMMENT:0> '
  + '<NAME:0> <QTH:0> <RST_SENT:2>59 <RST_RCVD:2>59 <GRIDSQUARE:6>KO02MF '
  + '<FREQ:7>14.2500 <TX_PWR:3>100 <STATION_CALLSIGN:6>SQ8BWM <OPERATOR:6>SQ8BWM '
  + '<MY_GRIDSQUARE:0> <EOR>';

const BBL_XML = '<?xml version="1.0" encoding="utf-8"?><contactinfo><app>BBLogger</app>'
  + '<timestamp>2026-10-05 12:58:17</timestamp><mycall>SQ8BWM</mycall><band>20m</band>'
  + '<rxfreq>142500</rxfreq><txfreq>142500</txfreq><operator>SQ8BWM</operator>'
  + '<mode>SSB</mode><call>SN1TEST</call><snt>59</snt><rcv>59</rcv>'
  + '<gridsquare>KO02MF</gridsquare><comment></comment><qth></qth><name></name>'
  + '<power>100</power><StationName>SQ8BWM</StationName></contactinfo>';

describe('przechwycone datagramy BBLoggera — oba formaty', () => {
  const zamykacze2 = [];
  after(async () => { for (const f of zamykacze2) await f(); });

  async function przezNasluch(dane) {
    const odebrane = [];
    const pipeline = new QsoPipeline({
      operations: ['insert'], pin: 'TEST', targets: [],
      onQSO: (item) => odebrane.push(item),
    });
    const port = await wolnyPortUdp();
    const l = new LoggerListener({ host: '127.0.0.1', port, pipeline });
    await l.start();
    zamykacze2.push(() => l.stop());
    await new Promise((gotowe, blad) => {
      const s = dgram.createSocket('udp4');
      s.send(Buffer.from(dane), port, '127.0.0.1', (err) => { s.close(); err ? blad(err) : gotowe(); });
    });
    await new Promise((r) => setTimeout(r, 80));
    return odebrane;
  }

  test('ADIF: komplet pól, z pasmem i gridem', async () => {
    const [qso] = await przezNasluch(BBL_ADIF);
    assert.ok(qso, 'datagram ADIF z BBLoggera ma zostać rozpoznany');
    assert.equal(qso.payload.callsign, 'SN1TEST');
    assert.equal(qso.payload.band, '20m');
    assert.equal(qso.payload.freq, '14.2500');
    assert.equal(qso.payload.gridsquare, 'KO02MF');
    assert.equal(qso.payload.station_callsign, 'SQ8BWM');
  });

  test('XML N1MM: ta sama łączność wychodzi tak samo', async () => {
    // REGRES 2026-10-05: wychodziło freq 1.425 i BRAK pasma, bo BBLogger podaje
    // <txfreq> w dziesiątych kHz (142500 = 14250,0 kHz), a N1MM+ w setnych
    // (1425000). Serwer dostawałby QSO z częstotliwością spoza pasm amatorskich.
    const [qso] = await przezNasluch(BBL_XML);
    assert.ok(qso, 'datagram XML z BBLoggera ma zostać rozpoznany');
    assert.equal(qso.payload.callsign, 'SN1TEST');
    assert.equal(qso.payload.band, '20m', 'pasmo MUSI powstać');
    assert.equal(qso.payload.freq, '14.25');
    assert.equal(qso.payload.gridsquare, 'KO02MF');
  });

  test('oba formaty opisują TĘ SAMĄ łączność', async () => {
    const [zAdif] = await przezNasluch(BBL_ADIF);
    const [zXml] = await przezNasluch(BBL_XML);
    for (const pole of ['callsign', 'band', 'mode', 'station_callsign', 'operator', 'gridsquare']) {
      assert.equal(zXml.payload[pole], zAdif.payload[pole], `różnica w polu ${pole}`);
    }
    // Zapis częstotliwości się różni („14.2500" vs „14.25"), ale wartość nie.
    assert.equal(Number(zXml.payload.freq), Number(zAdif.payload.freq));
  });
});

describe('jednostka <txfreq> nie jest jedna', () => {
  test('N1MM+ (setne kHz) i BBLogger (dziesiąte kHz) dają to samo', () => {
    const n1mmPlus = BBL_XML.replace('<txfreq>142500<', '<txfreq>1425000<')
      .replace('<band>20m<', '<band>14<');
    assert.equal(dekoderN1mm.decode(Buffer.from(n1mmPlus)).adif.freq, '14.25');
    assert.equal(dekoderN1mm.decode(Buffer.from(BBL_XML)).adif.freq, '14.25');
  });

  test('17 m rozstrzyga PASMO, nie zgadywanie po liczbie', () => {
    // Tu widać, czemu nie wolno wybierać „tego, co wpada w jakiekolwiek pasmo":
    // 181000 czytane po N1MM-owemu to 1,81 MHz, czyli 160 m — pasmo istnieje,
    // więc heurystyka „pierwszy sensowny wynik" dałaby cichy błąd.
    const bbl17 = BBL_XML.replace('<txfreq>142500<', '<txfreq>181000<')
      .replace('<rxfreq>142500<', '<rxfreq>181000<')
      .replace('<band>20m<', '<band>17m<');
    const r = dekoderN1mm.decode(Buffer.from(bbl17));
    assert.equal(r.adif.band, '17m');
    assert.equal(r.adif.freq, '18.1');
  });

  test('bez <txfreq> pasmo ocalone z nazwy w <band>', () => {
    // BBLogger wpisuje do <band> gotową nazwę ADIF („20m"), a nie MHz-e jak N1MM+.
    // Gdyby QSO przyszło bez częstotliwości, pasmo i tak nie ma prawa przepaść —
    // bez niego serwer nie wie, na czym łączność była.
    const bezFreq = BBL_XML.replace('<txfreq>142500</txfreq>', '')
      .replace('<rxfreq>142500</rxfreq>', '');
    const r = dekoderN1mm.decode(Buffer.from(bezFreq));
    assert.equal(r.adif.band, '20m');
    assert.equal(r.adif.freq, undefined, 'częstotliwości nie wymyślamy');
  });

  test('bez <band> zostaje zachowanie sprzed zmiany (setne kHz)', () => {
    const bezPasma = BBL_XML.replace('<band>20m</band>', '');
    assert.equal(dekoderN1mm.decode(Buffer.from(bezPasma)).adif.freq, '1.425');
  });
});
