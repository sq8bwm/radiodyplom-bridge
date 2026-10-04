// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Pamięć na nieznane datagramy.
//
// PO CO TO POWSTAŁO: dekodera nowego loggera nie da się napisać z opisu formatu
// — sprawdzone dwa razy (Logger32, BBLogger). Potrzebny jest prawdziwy datagram,
// a prośba „przechwyć go przez nc" na Windowsie oznacza instalowanie narzędzi.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { zapiszNieznany, doZgloszenia, ILE_RODZAJOW, LIMIT_BAJTOW, KATALOG } from '../src/nieznane.js';
import { QsoPipeline } from '../src/qso-pipeline.js';
import { buildReport } from '../src/report.js';
import { setLevel } from '../src/log.js';

setLevel('error');

const kosze = [];
const kosz = () => {
  const d = mkdtempSync(join(tmpdir(), 'rd-nieznane-'));
  kosze.push(d);
  return d;
};
after(() => kosze.forEach((d) => rmSync(d, { recursive: true, force: true })));

const pliki = (dir) => {
  try { return readdirSync(join(dir, KATALOG)); } catch { return []; }
};

describe('zapisywanie nieznanych datagramów', () => {
  test('pierwszy datagram danego rodzaju trafia na dysk', () => {
    const dir = kosz();
    const w = zapiszNieznany(Buffer.from('WT:ADDQSO:SP9ABC'), '127.0.0.1:9871', { dataDir: dir });
    assert.ok(w, 'miał zostać zapisany');
    assert.equal(pliki(dir).length, 1);
    assert.match(w.plik, new RegExp(w.odcisk), 'nazwa pliku niesie odcisk rodzaju');
  });

  test('ten sam rodzaj drugi raz jest POMIJANY', () => {
    // Logger wysyłający dziesięć QSO w jednym formacie ma zająć jedno miejsce.
    const dir = kosz();
    const tresc = Buffer.from('<nieznanyxml><call>SP9ABC</call></nieznanyxml>');
    assert.ok(zapiszNieznany(tresc, 'a', { dataDir: dir }));
    assert.equal(zapiszNieznany(tresc, 'b', { dataDir: dir }), null);
    assert.equal(zapiszNieznany(tresc, 'c', { dataDir: dir }), null);
    assert.equal(pliki(dir).length, 1);
  });

  test('różne rodzaje dostają osobne pliki', () => {
    const dir = kosz();
    zapiszNieznany(Buffer.from('FORMAT-A: cokolwiek'), 'a', { dataDir: dir });
    zapiszNieznany(Buffer.from('FORMAT-B: zupełnie inne'), 'b', { dataDir: dir });
    assert.equal(pliki(dir).length, 2);
  });

  test(`po ${ILE_RODZAJOW} rodzajach przestajemy zapisywać`, () => {
    // Limit jest po to, żeby pomyłkowy strumień na nasz port nie zapełnił dysku.
    const dir = kosz();
    for (let i = 0; i < ILE_RODZAJOW + 3; i += 1) {
      zapiszNieznany(Buffer.from(`RODZAJ-${i}-${'x'.repeat(i + 1)}`), 'x', { dataDir: dir });
    }
    assert.equal(pliki(dir).length, ILE_RODZAJOW);
  });

  test('wielki datagram jest przycinany, a nie zapisywany w całości', () => {
    const dir = kosz();
    const w = zapiszNieznany(Buffer.alloc(LIMIT_BAJTOW * 3, 0x41), 'x', { dataDir: dir });
    assert.equal(statSync(w.plik).size, LIMIT_BAJTOW);
  });

  test('brak katalogu danych nie wywraca niczego', () => {
    // Testy jednostkowe tworzą potok bez dataDir — ma po prostu nie zapisywać.
    assert.equal(zapiszNieznany(Buffer.from('cokolwiek'), 'x', { dataDir: null }), null);
  });

  test('plik ma prawa 0600 — bywa w nim treść cudzego QSO', () => {
    const dir = kosz();
    const w = zapiszNieznany(Buffer.from('JAKIS-FORMAT'), 'x', { dataDir: dir });
    assert.equal(statSync(w.plik).mode & 0o777, 0o600);
  });
});

describe('nieznane datagramy w zgłoszeniu', () => {
  test('hex i czytelny podgląd, przycięte do limitu', () => {
    const dir = kosz();
    zapiszNieznany(Buffer.from('SWISSLOG|SP5XYZ|40m|CW'), 'x', { dataDir: dir });
    const [wpis] = doZgloszenia(dir, { limit: 10 });
    assert.equal(wpis.bajtow, 22, 'rozmiar całego pliku, nie przyciętego kawałka');
    assert.equal(wpis.hex.length, 20, '10 bajtów = 20 znaków hex');
    assert.equal(wpis.podglad, 'SWISSLOG|S');
  });

  test('znaki sterujące nie psują podglądu', () => {
    const dir = kosz();
    zapiszNieznany(Buffer.from([0xad, 0xbc, 0xcb, 0xda, 0x00, 0x02]), 'x', { dataDir: dir });
    const [wpis] = doZgloszenia(dir);
    assert.doesNotMatch(wpis.podglad, /[\u0000-\u001f]/, 'bajty sterujące mają być zastąpione');
    assert.match(wpis.hex, /^adbccbda/, 'hex zostaje nietknięty — po nim poznajemy format');
  });

  test('pusty katalog to pusta lista, nie wyjątek', () => {
    assert.deepEqual(doZgloszenia(kosz()), []);
  });

  test('zgłoszenie NIE wynosi PIN-u, nawet gdy siedzi w datagramie', () => {
    // Gdyby czyjś logger wysyłał klucz w treści, trafiłby prosto do pliku, który
    // człowiek wysyła obcym. Maskowanie zgłoszenia musi obejmować i tę sekcję.
    const dir = kosz();
    const cfg = JSON.parse(readFileSync(new URL('../config.example.json', import.meta.url), 'utf8'));
    cfg.radiodyplom.pin = 'TAJN-1234';
    cfg.queue = { ...cfg.queue, dir: join(dir, 'queue'), seenFile: join(dir, 'seen.json') };
    zapiszNieznany(Buffer.from('LOGGER-X api_key=TAJN-1234 call=SP9ABC'), 'x', { dataDir: dir });

    const raport = buildReport({ cfg });
    const tekst = JSON.stringify(raport);
    assert.equal(raport.nieznaneDatagramy.length, 1, 'datagram ma być w zgłoszeniu');
    assert.ok(!tekst.includes('TAJN-1234'), 'PIN nie może wyjść w zgłoszeniu');
  });
});

describe('potok odkłada nieznane sam', () => {
  test('datagram, którego nie rozpoznał żaden dekoder, ląduje na dysku', () => {
    // Behawioralnie: wpuszczamy śmieci przez prawdziwy potok, nie wołamy
    // zapisu ręcznie.
    const dir = kosz();
    const potok = new QsoPipeline({
      operations: ['insert'], pin: 'X', targets: [], onQSO: () => {}, dataDir: dir,
    });
    potok.handle(Buffer.from('ZUPELNIE-OBCY-FORMAT-123'), '127.0.0.1:5555');
    assert.equal(pliki(dir).length, 1);
    assert.equal(potok.stats.unknown, 1);
  });

  test('rozpoznanego formatu NIE odkładamy', () => {
    // Zapisujemy wyłącznie to, czego nie umiemy odczytać — reszta byłaby
    // podsłuchiwaniem własnych użytkowników.
    const dir = kosz();
    const potok = new QsoPipeline({
      operations: ['insert'], pin: 'X', targets: [], onQSO: () => {}, dataDir: dir,
    });
    potok.handle(Buffer.from('<CALL:6>SP9ABC<QSO_DATE:8>20261004<TIME_ON:6>120000'
      + '<BAND:3>20m<MODE:3>SSB<STATION_CALLSIGN:6>SQ8BWM<EOR>'), '127.0.0.1:5555');
    assert.equal(pliki(dir).length, 0);
    assert.equal(potok.stats.unknown, 0);
  });
});
