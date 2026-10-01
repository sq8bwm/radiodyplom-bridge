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
import { mapToRadiodyplom } from '../src/mapper.js';
import { Logger32Listener } from '../src/tcp.js';
import { setLevel, recentLog } from '../src/log.js';

setLevel('error');

const QSO = '<call:6>SP9XYZ<qso_date:8>20260930<time_on:6>121500<band:3>40m'
  + '<mode:3>SSB<station_callsign:6>SQ8BWM<freq:5>7.140<rst_sent:2>59<rst_rcvd:2>59<eor>';

// PRAWDZIWY rekord z Logger32, przechwycony 2026-09-30 na Windowsie — wklejony
// bajt w bajt, z wielkimi literami w tagach i spacjami między polami.
// Wszystko, co wiemy o formacie tego programu, pochodzi stąd.
const PRAWDZIWY = '<BAND:3>80m <CALL:6>SQ8BWA <CONT:2>EU <CQZ:2>15 <DXCC:3>269 '
  + '<FREQ:8>3.700000 <ITUZ:2>28 <MODE:3>SSB <OPERATOR:6>SQ8BWM <PFX:3>SQ8 <QSLMSG:0> '
  + '<QSO_DATE:8>20260930 <TIME_ON:6>155158 <RST_RCVD:2>59 <RST_SENT:2>59 '
  + '<TIME_OFF:6>155232 <APP_LOGGER32_QSO_NUMBER:1>1 <EOR>';

describe('prawdziwy rekord z Logger32', () => {
  test('znak stacji bierzemy z pola OPERATOR, bo Logger32 nie wysyła STATION_CALLSIGN', () => {
    // To był powód, dla którego pierwsze prawdziwe QSO odpadło:
    // „bez wymaganych pól – missing: station_callsign".
    const r = logger32.decode(Buffer.from(PRAWDZIWY));
    assert.equal(r.adif.station_callsign, 'SQ8BWM');
    assert.equal(r.adif.call, 'SQ8BWA');
    assert.equal(r.meta.stacjaZOperatora, true, 'ślad, że znak jest podstawiony');
  });

  test('własny znak stacji z rekordu ma pierwszeństwo nad OPERATOR-em', () => {
    const zeStacja = PRAWDZIWY.replace('<EOR>', '<STATION_CALLSIGN:4>SN8N<EOR>');
    const r = logger32.decode(Buffer.from(zeStacja));
    assert.equal(r.adif.station_callsign, 'SN8N');
    assert.equal(r.meta.stacjaZOperatora, undefined);
  });

  test('numer QSO z Logger32 trafia do klucza deduplikacji', () => {
    const r = logger32.decode(Buffer.from(PRAWDZIWY));
    assert.match(r.key, /^logger32:1:/);
    // inny numer tej samej treści to inna łączność (np. po skasowaniu i wpisaniu na nowo)
    const drugi = logger32.decode(Buffer.from(PRAWDZIWY.replace('QSO_NUMBER:1>1', 'QSO_NUMBER:1>2')));
    assert.notEqual(r.key, drugi.key);
  });

  test('cały rekord przechodzi mapowanie na pola radiodyplom', () => {
    const r = logger32.decode(Buffer.from(PRAWDZIWY));
    const m = mapToRadiodyplom(r.adif, 'PIN');
    assert.equal(m.ok, true, `brakowało: ${m.missing}`);
    assert.equal(m.payload.callsign, 'SQ8BWA');
    assert.equal(m.payload.station_callsign, 'SQ8BWM');
    assert.equal(m.payload.band, '80m');
    assert.equal(m.payload.mode, 'SSB');
    assert.equal(m.payload.qso_date, '20260930');
    assert.equal(m.payload.time_on, '155158');
    assert.equal(m.payload.freq, '3.700000');
  });

  test('wielkie litery w tagach i spacje między polami nie przeszkadzają', () => {
    const k = koniecRekordu(PRAWDZIWY);
    assert.ok(k, '<EOR> wielkimi literami musi kończyć rekord');
    assert.equal(PRAWDZIWY.slice(k.koniec), '');
    // pole o zerowej długości (<QSLMSG:0>) nie może rozjechać parsera
    assert.equal(parseAdif(PRAWDZIWY).qslmsg, '');
    assert.equal(parseAdif(PRAWDZIWY).pfx, 'SQ8');
  });
});

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

  test('dane w NIEZNANYM formacie zostawiają ślad w logu', async () => {
    // Cisza jest tu najgorszą odpowiedzią: „przyszło coś, czego nie rozumiem"
    // i „nic nie przyszło" wyglądałyby identycznie, a to dwie różne przyczyny.
    // Sprawdzone realnie 2026-09-30: zwykły tekst po TCP przepadał bez wpisu.
    // Czytamy bufor logu, ten sam, który zasila zakładkę Log — bez podmieniania
    // strumieni (log pisze wprost na stderr, nie przez console.warn).
    setLevel('warn');
    try {
      const { port, odebrane } = await nasluch();
      await wyslij(port, 'QSO: SP9ABC 20260930 1200 40m SSB\n');
      await chwila();
      assert.equal(odebrane.length, 0, 'to nie jest QSO');
      const tekst = recentLog(20).map((w) => `${w.msg} ${JSON.stringify(w.extra ?? '')}`).join('\n');
      assert.match(tekst, /nie rozpoznaję/);
      assert.match(tekst, /SP9ABC/, 'w logu musi być POCZĄTEK treści, inaczej nie da się dopisać dekodera');
    } finally {
      setLevel('error');
    }
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

  test('klucze TCP są na liście zmian wymagających restartu', () => {
    // UWAGA: sama obecność na liście NIE wystarcza — trzeba jeszcze oznaczyć
    // zmianę przy porównaniu. Przez brak tego drugiego okno mówiło „Zapisano
    // i zastosowano", choć nasłuch powstaje dopiero przy starcie (2026-09-30).
    // Zachowanie sprawdza test „nasłuch TCP wymaga restartu" w configedit.test.js.
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

describe('nasłuch UDP wyłączony — zostaje sam Logger32', () => {
  const D = readFileSync('src/daemon.js', 'utf8');

  test('gniazdo UDP powstaje tylko przy włączonym nasłuchu', () => {
    assert.match(D, /const udpWlaczony = cfg\.udp\.enabled !== false;/);
    assert.match(D, /if \(udpWlaczony\) \{[\s\S]{0,400}await listener\.start\(\);/,
      'start nasłuchu musi być pod warunkiem');
  });

  test('obiekt nasłuchu istnieje mimo to — okno czyta z niego liczniki', () => {
    // Gdyby daemon go nie tworzył, panele Źródła i Statystyki straciłyby dane
    // także dla QSO przychodzących po TCP, bo liczniki są wspólne.
    const przedStartem = D.indexOf('const udpWlaczony');
    assert.ok(D.indexOf('new LoggerListener') < przedStartem,
      'nasłuch ma powstawać zanim zdecydujemy o starcie gniazda');
  });

  test('zatrzymanie niewystartowanego nasłuchu nie wywala programu', async () => {
    // Zamknięcie okna woła stop() bezwarunkowo. Wyjątek w tym miejscu zostawiłby
    // wiszący proces — przy wyłączonym UDP nie ma ani socketu, ani blokady portu.
    const { LoggerListener } = await import('../src/udp.js');
    const { QsoPipeline } = await import('../src/qso-pipeline.js');
    const l = new LoggerListener({
      host: '127.0.0.1',
      port: 12060,
      pipeline: new QsoPipeline({ operations: ['insert'], pin: 'X', targets: [], onQSO: () => {} }),
    });
    assert.doesNotThrow(() => l.stop());
  });

  test('oba nasłuchy wyłączone — program to mówi, zamiast milczeć', () => {
    assert.match(D, /if \(!udpWlaczony && !tcpListener\) \{/);
    assert.match(D, /ŻADEN nasłuch nie jest włączony/);
  });
});
