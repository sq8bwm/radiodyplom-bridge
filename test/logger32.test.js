// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Logger32: dekoder ADIF-a i nasłuch TCP.
//
// Logger32 nie rozgłasza QSO po UDP — jako klient TCP łączy się pod wskazany
// adres i port i wysyła rekord ADIF, po czym zamyka połączenie. Testy
// odtwarzają to zachowanie prawdziwym gniazdem, bo właśnie sklejanie strumienia
// jest tu jedyną nietrywialną rzeczą.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readFileSync } from 'node:fs';

import { koniecRekordu, parseAdif } from '../src/adif.js';
import * as logger32 from '../src/decoders/logger32.js';
import { pickDecoder } from '../src/decoders/index.js';
import { QsoPipeline } from '../src/qso-pipeline.js';
import { Logger32Listener } from '../src/tcp.js';
import { setLevel } from '../src/log.js';

setLevel('error');

const QSO = '<call:6>SP9XYZ<qso_date:8>20260930<time_on:6>121500<band:3>40m'
  + '<mode:3>SSB<station_callsign:6>SQ8BWM<freq:5>7.140<rst_sent:2>59<rst_rcvd:2>59<eor>';

describe('rozpoznawanie ADIF-a obok innych formatów', () => {
  test('rekord Logger32 trafia do właściwego dekodera', () => {
    const d = pickDecoder(Buffer.from(QSO));
    assert.equal(d.name, 'Logger32');
  });

  test('XML N1MM NIE trafia do Logger32', () => {
    // Oba zaczynają się od „<". Rozróżnia je deklarowana długość w tagu ADIF-a,
    // więc kolejność dekoderów i kształt `detect` to tu cała różnica.
    const xml = Buffer.from('<?xml version="1.0"?><contactinfo><call>SP1AAA</call></contactinfo>');
    assert.equal(logger32.detect(xml), false);
    assert.equal(pickDecoder(xml).name, 'N1MM');
  });

  test('JSON QLoga nie jest ruszany', () => {
    const json = Buffer.from(JSON.stringify({ appid: 'QLog', msgtype: 'qso', data: {} }));
    assert.equal(logger32.detect(json), false);
  });

  test('sam nagłówek pliku ADIF to nie QSO', () => {
    const r = logger32.decode(Buffer.from('<adif_ver:5>3.1.4<programid:9>Logger32<eoh>'));
    assert.equal(r, null);
  });

  test('klucz deduplikacji powstaje z treści (Logger32 nie daje numeru rekordu)', () => {
    const a = logger32.decode(Buffer.from(QSO));
    const b = logger32.decode(Buffer.from(QSO));
    assert.equal(a.key, b.key, 'ten sam rekord ma dać ten sam klucz');
    assert.match(a.key, /^logger32:noid:/);
    const inny = logger32.decode(Buffer.from(QSO.replace('SP9XYZ', 'SP9ABC')));
    assert.notEqual(a.key, inny.key);
  });
});

describe('szukanie końca rekordu w strumieniu', () => {
  test('„<eor>" w środku WARTOŚCI nie kończy rekordu', () => {
    // Tu naiwne `split("<eor>")` urwałoby QSO w połowie i zgubiło znak stacji.
    const zPulapka = '<call:6>SP9XYZ<comment:11><eor> w QTH<qso_date:8>20260930<eor>reszta';
    const k = koniecRekordu(zPulapka);
    assert.ok(k);
    const rekord = zPulapka.slice(0, k.koniec);
    assert.equal(parseAdif(rekord).qso_date, '20260930', 'rekord ma sięgać PO pułapce');
    assert.equal(zPulapka.slice(k.koniec), 'reszta');
  });

  test('niekompletny rekord czeka na resztę', () => {
    assert.equal(koniecRekordu('<call:6>SP9X'), null);
    assert.equal(koniecRekordu('<call:6>SP9XYZ<band:3>40m'), null);
  });

  test('nagłówek jest rozpoznawany osobno', () => {
    const k = koniecRekordu('Logger32 export\n<adif_ver:5>3.1.4<eoh><call:6>SP9XYZ<eor>');
    assert.equal(k.naglowek, true);
  });
});

describe('nasłuch TCP zachowuje się jak Logger32', () => {
  const zamykacze = [];
  after(() => zamykacze.forEach((f) => f()));

  /** Podnosi nasłuch na wolnym porcie i zwraca {port, odebrane}. */
  async function nasluch() {
    const odebrane = [];
    const pipeline = new QsoPipeline({
      operations: ['insert'], pin: 'TEST', targets: [],
      onQSO: (item) => odebrane.push(item),
    });
    const l = new Logger32Listener({ host: '127.0.0.1', port: 0, pipeline });
    await l.start();
    zamykacze.push(() => l.stop());
    return { port: l.server.address().port, odebrane, pipeline, listener: l };
  }

  /** Udaje Logger32: łączy się, wysyła, zamyka. */
  function wyslij(port, dane, { zamknij = true } = {}) {
    return new Promise((gotowe, blad) => {
      const s = net.connect(port, '127.0.0.1', () => {
        s.write(dane);
        if (zamknij) s.end();
      });
      s.on('close', gotowe);
      s.on('error', blad);
    });
  }

  const chwila = () => new Promise((r) => setTimeout(r, 60));

  test('jedno QSO: połączenie, rekord, rozłączenie', async () => {
    const { port, odebrane } = await nasluch();
    await wyslij(port, QSO);
    await chwila();
    assert.equal(odebrane.length, 1);
    assert.equal(odebrane[0].payload.callsign, 'SP9XYZ');
    assert.equal(odebrane[0].payload.station_callsign, 'SQ8BWM');
    assert.equal(odebrane[0].meta.source, 'Logger32');
  });

  test('rekord rozbity na kawałki jest sklejany', async () => {
    // Tego nie da się sprawdzić inaczej niż prawdziwym gniazdem: dane
    // przychodzą tak, jak je poszatkuje sieć, a nie tak, jak je wysłano.
    const { port, odebrane } = await nasluch();
    await new Promise((gotowe) => {
      const s = net.connect(port, '127.0.0.1', async () => {
        s.write(QSO.slice(0, 20));
        await chwila();
        s.write(QSO.slice(20, 45));
        await chwila();
        s.write(QSO.slice(45));
        s.end();
      });
      s.on('close', gotowe);
    });
    await chwila();
    assert.equal(odebrane.length, 1);
    assert.equal(odebrane[0].payload.callsign, 'SP9XYZ');
  });

  test('kilka rekordów w jednym połączeniu', async () => {
    const { port, odebrane } = await nasluch();
    await wyslij(port, QSO + QSO.replace('SP9XYZ', 'SP9ABC') + QSO.replace('SP9XYZ', 'SP9DEF'));
    await chwila();
    assert.equal(odebrane.length, 3);
    assert.deepEqual(odebrane.map((o) => o.payload.callsign), ['SP9XYZ', 'SP9ABC', 'SP9DEF']);
  });

  test('QSO BEZ znacznika <eor> nie przepada — ratuje je zamknięcie połączenia', async () => {
    // Node-RED w działającym wdrożeniu czyta ten strumień w trybie „single",
    // czyli polega na zamknięciu połączenia. Gdybyśmy wymagali `<eor>`,
    // takie QSO zginęłoby po cichu.
    const { port, odebrane } = await nasluch();
    await wyslij(port, QSO.replace('<eor>', ''));
    await chwila();
    assert.equal(odebrane.length, 1);
    assert.equal(odebrane[0].payload.callsign, 'SP9XYZ');
  });

  test('nagłówek ADIF-a przed rekordem nie zakłóca', async () => {
    const { port, odebrane } = await nasluch();
    await wyslij(port, `Logger32\n<adif_ver:5>3.1.4<eoh>${QSO}`);
    await chwila();
    assert.equal(odebrane.length, 1);
  });

  test('śmieci nie wywalają nasłuchu ani nie liczą się jako QSO', async () => {
    const { port, odebrane, pipeline } = await nasluch();
    await wyslij(port, 'zupełnie nie ADIF\n');
    await chwila();
    assert.equal(odebrane.length, 0);
    assert.equal(pipeline.stats.accepted, 0);
    // a po śmieciach nasłuch nadal działa
    await wyslij(port, QSO);
    await chwila();
    assert.equal(odebrane.length, 1);
  });

  test('statystyki są WSPÓLNE z nasłuchem UDP', async () => {
    // Jeden potok = jedna suma w oknie. Inaczej „odebrane z loggera"
    // pokazywałoby tylko połowę prawdy.
    const { port, pipeline } = await nasluch();
    await wyslij(port, QSO);
    await chwila();
    assert.equal(pipeline.stats.accepted, 1);
    assert.equal(pipeline.stats.bySource.Logger32, 1);
    assert.equal(pipeline.stats.lastStation, 'SQ8BWM');
  });
});

describe('wpięcie w program', () => {
  const D = readFileSync(new URL('../src/daemon.js', import.meta.url), 'utf8');
  const H = readFileSync(new URL('../src/httpapi.js', import.meta.url), 'utf8');
  const C = readFileSync(new URL('../src/configedit.js', import.meta.url), 'utf8');
  const R = readFileSync(new URL('../ui/renderer.js', import.meta.url), 'utf8');
  const S = readFileSync(new URL('../ui/strings.js', import.meta.url), 'utf8');
  const X = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
  const PRZYKLAD = JSON.parse(readFileSync(new URL('../config.example.json', import.meta.url), 'utf8'));

  test('domyślnie WYŁĄCZONY', () => {
    // Otwarty port bez powodu to niepotrzebna powierzchnia u wszystkich, którzy
    // Logger32 nie używają — a to większość.
    assert.equal(PRZYKLAD.tcp.enabled, false);
    assert.equal(PRZYKLAD.tcp.host, '127.0.0.1');
    assert.equal(PRZYKLAD.tcp.port, 52005);
    assert.match(D, /if \(cfg\.tcp\?\.enabled\)/);
  });

  test('oba nasłuchy dzielą JEDEN potok', () => {
    // Inaczej „odebrane z loggera" w oknie pokazywałoby tylko połowę.
    assert.match(D, /const pipeline = new QsoPipeline\(/);
    assert.match(D, /new LoggerListener\(\{[\s\S]{0,200}pipeline,/);
    assert.match(D, /new Logger32Listener\(\{[\s\S]{0,200}pipeline,/);
  });

  test('stan pokazuje nasłuch TCP, a StatusApi go dostaje', () => {
    assert.match(D, /new StatusApi\(\{\s*\n\s*cfg, store, listener, tcpListener, worker,/);
    assert.match(H, /tcp: this\.tcpListener \? \{/);
    assert.match(R, /tcp\.hidden = !s\.tcp;/);
  });

  test('zmiana ustawień TCP wymaga restartu', () => {
    // Gniazdo powstaje raz, przy starcie — jak każde inne.
    assert.match(C, /'tcp\.enabled', 'tcp\.host', 'tcp\.port',/);
  });

  test('ustawienia przeżywają zapis z okna', () => {
    // Ta pułapka zdarzyła się już przy motywie i przy skali czcionki:
    // brak pola w `writeConfigFile` = wybór ginie przy pierwszym zapisie.
    assert.match(C, /tcp: \{\s*\n\s*\.\.\.\(original\.tcp \|\| \{\}\),/);
    assert.match(C, /if \(patch\.tcp\) \{/);
  });

  test('formularz ma pola i oba języki mają teksty', () => {
    for (const id of ['fTcpEnabled', 'fTcpHost', 'fTcpPort']) {
      assert.match(X, new RegExp(`id="${id}"`), `brak pola ${id}`);
    }
    assert.match(R, /\$\('fTcpEnabled'\)\.checked = cfg\.tcp\?\.enabled === true;/);
    assert.match(R, /enabled: \$\('fTcpEnabled'\)\.checked,/);
    for (const k of ['panel.tcp', 'label.tcpEnabled', 'note.tcp', 'state.tcpFor']) {
      const ile = [...S.matchAll(new RegExp(`'${k.replace('.', '\\.')}':`, 'g'))].length;
      assert.equal(ile, 2, `${k} ma ${ile} tłumaczeń, a ma mieć 2`);
    }
  });

  test('podpowiedź mówi, co włączyć w Logger32', () => {
    const m = S.match(/'note\.tcp': '([^']*(?:'\s*\+\s*'[^']*)*)'/);
    assert.ok(m);
    assert.match(m[1], /enable QSO export by TCP/);
    assert.match(m[1], /4\.0\.344/);
  });
});
