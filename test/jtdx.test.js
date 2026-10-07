// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// JTDX 2.2.159 — PRAWDZIWE datagramy, przechwycone 2026-10-07 na Ubuntu 24.04
// (pakiet `jtdx` 2.2.159-2build2, radio nieustawione, jedno kliknięcie „Log QSO").
//
// „JTDX ≥ 2.2.158" stało w README, docs i dwóch komentarzach w kodzie od
// pierwszego commitu i NIGDY nie zostało sprawdzone — tak samo jak wcześniej
// QARTest, Log4OM i DXLog. Ten plik to zamyka.
//
// Okazało się, że JTDX ma dla zalogowanego QSO AŻ TRZY kanały, a nie jeden:
//
//   1. Primary UDP Server       — binarny QDataStream, typ 5 „QSO Logged",
//   2. ten sam serwer + haczyk „Enable sending logged QSO ADIF data" — typ 12,
//   3. 2nd UDP server           — GOŁY REKORD ADIF, bez nagłówka,
//      (jest jeszcze czwarty: TCP server na porcie 52001, też ADIF — nie
//       sprawdzony, bo to nasza ścieżka Logger32, która już ma własne testy).
//
// Rozumiemy wszystkie trzy, bez żadnej zmiany w kodzie: dwa pierwsze idą przez
// dekoder WSJT-X, trzeci przez dekoder ADIF-owy (Logger32/BBLogger).
//
// NAJWAŻNIEJSZE: jeśli ktoś włączy oba serwery naraz i skieruje je na mostek,
// JEDNA łączność przyjdzie TRZEMA datagramami z DWÓCH różnych źródeł
// (`wsjtx:` i `logger32:`). Odcisk treści jest identyczny, więc ratuje nas
// deduplikacja międzyźródłowa z 06.10 — i to jest jej pierwszy test na
// prawdziwych bajtach programu, który faktycznie tak nadaje.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pickDecoder } from '../src/decoders/index.js';
import { mapToRadiodyplom } from '../src/mapper.js';
import { Store } from '../src/store.js';
import { QsoPipeline } from '../src/qso-pipeline.js';
import { setLevel } from '../src/log.js';

setLevel('error');

// Primary UDP Server, typ 5 „QSO Logged" — 135 B, bajt w bajt z podsłuchu.
const TYP5 = Buffer.from(
  "adbccbda0000000200000005000000044a5444580000000000258e8902968caf000000000653"
  + "503958595a000000044a4f39310000000000d6c66c00000003465438000000032d3135000000"
  + "032d31350000000000000000000000000000000000258e8902968caf00000000065351384257"
  + "4d0000000653513842574d000000064b4f30326c6a", 'hex');

// Ten sam serwer, typ 12 „Logged ADIF" — 314 B, bajt w bajt.
const TYP12 = Buffer.from(
  "adbccbda000000020000000c000000044a544458000001220a3c616469665f7665723a353e33"
  + "2e312e300a3c70726f6772616d69643a343e4a5444580a3c454f483e0a3c42414e443a333e32"
  + "306d203c53544154494f4e5f43414c4c5349474e3a363e53513842574d203c4d595f47524944"
  + "5351554152453a363e4b4f30326c6a203c43414c4c3a363e53503958595a203c465245513a39"
  + "3e31342e303735353030203c4d4f44453a333e465438203c51534f5f444154453a383e323032"
  + "3631303037203c54494d455f4f4e3a363e313230333430203c51534f5f444154455f4f46463a"
  + "383e3230323631303037203c54494d455f4f46463a363e313230333430203c5253545f53454e"
  + "543a333e2d3135203c5253545f524356443a333e2d3135203c475249445351554152453a343e"
  + "4a4f3931203c454f523e", 'hex');

// 2nd UDP server — goły rekord ADIF, BEZ nagłówka „WSJT-X ADIF Export<eoh>",
// którym poprzedza swój typ 12. 247 B, przepisane znak w znak.
const ADIF = '<BAND:3>20m <STATION_CALLSIGN:6>SQ8BWM <MY_GRIDSQUARE:6>KO02lj '
  + '<CALL:6>SP9XYZ <FREQ:9>14.075500 <MODE:3>FT8 <QSO_DATE:8>20261007 '
  + '<TIME_ON:6>120340 <QSO_DATE_OFF:8>20261007 <TIME_OFF:6>120340 '
  + '<RST_SENT:3>-15 <RST_RCVD:3>-15 <GRIDSQUARE:4>JO91 <EOR>';

describe('JTDX 2.2.159 — trzy kanały jednej łączności', () => {
  test('typ 5 idzie przez dekoder WSJT-X i przedstawia się jako JTDX', () => {
    const d = pickDecoder(TYP5);
    assert.equal(d?.name, 'WSJT-X');
    const { meta } = d.decode(TYP5);
    assert.equal(meta.client, 'JTDX', 'to pole odróżnia JTDX od WSJT-X w logu mostka');
  });

  test('typ 12 też, i dokłada nazwę programu', () => {
    const { meta } = pickDecoder(TYP12).decode(TYP12);
    assert.equal(meta.client, 'JTDX');
    assert.equal(meta.program, 'JTDX');
  });

  test('goły ADIF z drugiego serwera trafia do dekodera ADIF-owego', () => {
    // Bez nagłówka ADIF — sam rekord. Rozpoznanie idzie po `<nazwa:długość>`.
    const d = pickDecoder(Buffer.from(ADIF));
    assert.equal(d?.name, 'ADIF');
  });

  for (const [nazwa, bufor] of [['typ 5', TYP5], ['typ 12', TYP12], ['ADIF', null]]) {
    test(`${nazwa}: cały rekord przechodzi mapowanie na pola radiodyplom`, () => {
      const b = bufor || Buffer.from(ADIF);
      const { adif } = pickDecoder(b).decode(b);
      const wynik = mapToRadiodyplom(adif, 'TEST');
      assert.equal(wynik.ok, true, `brakuje pól: ${wynik.missing}`);
      const p = wynik.payload;
      assert.equal(p.callsign, 'SP9XYZ');
      assert.equal(p.station_callsign, 'SQ8BWM');
      assert.equal(p.qso_date, '20261007');
      assert.equal(p.time_on, '120340');
      assert.equal(p.band, '20m');
      assert.equal(p.mode, 'FT8');
      assert.equal(p.report_sent, '-15');
      assert.equal(p.report_received, '-15');
    });
  }

  test('wszystkie trzy mają TEN SAM odcisk treści', () => {
    // Na tym stoi cała deduplikacja. Częstotliwość do odcisku NIE wchodzi —
    // i dobrze, bo typ 5 liczy ją z binarnych herców („14.0755"), a typ 12
    // i ADIF podają tekst „14.075500". Ta sama wartość, inny zapis.
    const odcisk = (b) => pickDecoder(b).decode(b).key.split(':').pop();
    const z5 = odcisk(TYP5);
    assert.equal(odcisk(TYP12), z5);
    assert.equal(odcisk(Buffer.from(ADIF)), z5);

    assert.equal(pickDecoder(TYP5).decode(TYP5).adif.freq, '14.0755');
    assert.equal(pickDecoder(TYP12).decode(TYP12).adif.freq, '14.075500');
  });

  test('ale źródła są DWA, więc same klucze nie wystarczą', () => {
    // wsjtx:… i logger32:… — gdyby deduplikacja patrzyła tylko na klucz,
    // ta sama łączność poszłaby na serwer dwa razy.
    assert.match(pickDecoder(TYP5).decode(TYP5).key, /^wsjtx:/);
    assert.match(pickDecoder(Buffer.from(ADIF)).decode(Buffer.from(ADIF)).key, /^logger32:/);
  });

  test('trzy datagramy z dwóch źródeł dają JEDNO QSO w kolejce', () => {
    const kat = mkdtempSync(join(tmpdir(), 'jtdx-'));
    try {
      const store = new Store({ dir: kat });
      const pipeline = new QsoPipeline({
        operations: new Set(['insert']), pin: 'TEST', targets: [],
        onQSO: (item) => { store.enqueue(item); },
      });
      for (const b of [TYP5, TYP12, Buffer.from(ADIF)]) {
        pipeline.handle(b, { address: '127.0.0.1', port: 1 });
      }
      assert.equal(store.list().length, 1, 'łączność poszłaby na serwer więcej niż raz');
      assert.match(store.list()[0].key, /^wsjtx:/, 'liczy się to, co przyszło pierwsze');
    } finally {
      rmSync(kat, { recursive: true, force: true });
    }
  });
});
