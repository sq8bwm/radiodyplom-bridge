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
