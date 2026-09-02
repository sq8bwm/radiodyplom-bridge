// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Klucze deduplikacji i zapis logu do pliku.
// Oba moduły powstały po realnej utracie QSO 2026-08-31.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { contentHash, qsoKey } from '../src/dedupkey.js';
import { enableFileLog, appendLine, closeFileLog, logFilePath } from '../src/logfile.js';

const QSO = {
  call: 'SP4OIK', qso_date: '20260831', time_on: '203552',
  band: '80m', mode: 'SSB', station_callsign: 'SQ8BWM',
};

describe('contentHash', () => {
  test('ta sama treść daje ten sam odcisk', () => {
    assert.equal(contentHash(QSO), contentHash({ ...QSO }));
  });

  test('każde pole tożsamości QSO zmienia odcisk', () => {
    for (const f of ['call', 'qso_date', 'time_on', 'band', 'mode', 'station_callsign']) {
      assert.notEqual(contentHash(QSO), contentHash({ ...QSO, [f]: 'INNE' }), `pole ${f}`);
    }
  });

  test('wielkość liter nie ma znaczenia', () => {
    assert.equal(contentHash(QSO), contentHash({ ...QSO, call: 'sp4oik', mode: 'ssb' }));
  });

  test('pola poprawiane po fakcie NIE wchodzą do odcisku', () => {
    // Raport czy komentarz można poprawić w loggerze — to wciąż ta sama łączność,
    // więc jej poprawienie nie może spowodować ponownej wysyłki.
    const withExtras = { ...QSO, rst_sent: '59', comment: 'cokolwiek', freq: '3.7' };
    assert.equal(contentHash(QSO), contentHash(withExtras));
  });
});

describe('qsoKey', () => {
  // REGRESJA (realna utrata QSO 2026-08-31): rowid z SQLite jest ponownie
  // używany po skasowaniu rekordu.
  test('ten sam identyfikator z innym QSO daje inny klucz', () => {
    const a = qsoKey('qlog', '{L}#54300', QSO);
    const b = qsoKey('qlog', '{L}#54300', { ...QSO, call: 'SP7VCL' });
    assert.notEqual(a, b);
  });

  test('ten sam rekord daje ten sam klucz (dedup nadal działa)', () => {
    assert.equal(qsoKey('qlog', '{L}#1', QSO), qsoKey('qlog', '{L}#1', QSO));
  });

  test('to samo QSO z innym identyfikatorem przechodzi (przelogowanie)', () => {
    assert.notEqual(qsoKey('qlog', '{L}#1', QSO), qsoKey('qlog', '{L}#2', QSO));
  });

  test('brak identyfikatora nie wywala klucza', () => {
    assert.match(qsoKey('wsjtx', null, QSO), /^wsjtx:noid:[0-9a-f]{12}$/);
  });

  test('źródło jest częścią klucza (brak kolizji między dekoderami)', () => {
    assert.notEqual(qsoKey('qlog', 'x', QSO), qsoKey('n1mm', 'x', QSO));
  });
});

describe('zapis logu do pliku', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rdb-log-')); });
  afterEach(() => { closeFileLog(); rmSync(dir, { recursive: true, force: true }); });

  test('linie trafiają do pliku', () => {
    const p = enableFileLog({ dir });
    appendLine('pierwsza');
    appendLine('druga');
    assert.equal(readFileSync(p, 'utf8'), 'pierwsza\ndruga\n');
  });

  test('dopisuje do istniejącego pliku, nie kasuje go', () => {
    enableFileLog({ dir });
    appendLine('stara');
    closeFileLog();
    const p = enableFileLog({ dir });
    appendLine('nowa');
    assert.equal(readFileSync(p, 'utf8'), 'stara\nnowa\n');
  });

  test('rotacja trzyma bieżący plus zadaną liczbę archiwów', () => {
    enableFileLog({ dir, maxBytes: 500, keep: 2 });
    for (let i = 0; i < 200; i++) appendLine(`linia ${i} z wypełniaczem dla rozmiaru`);
    const files = readdirSync(dir).sort();
    assert.ok(files.includes('bridge.log'));
    assert.ok(files.length <= 3, `plików: ${files.join(', ')}`);
    assert.ok(!existsSync(join(dir, 'bridge.log.3')), 'najstarsze archiwum ma być usuwane');
  });

  test('po wyłączeniu nic nie dopisuje', () => {
    const p = enableFileLog({ dir });
    appendLine('przed');
    closeFileLog();
    appendLine('po');
    assert.equal(readFileSync(p, 'utf8'), 'przed\n');
  });

  test('awaria zapisu nie rzuca wyjątkiem', () => {
    enableFileLog({ dir });
    rmSync(dir, { recursive: true, force: true });   // katalog znika pod plikiem
    assert.doesNotThrow(() => appendLine('cokolwiek'), 'log nie może wywrócić mostka');
  });

  test('logFilePath zwraca ścieżkę bieżącego pliku', () => {
    const p = enableFileLog({ dir });
    assert.equal(logFilePath(), p);
    assert.equal(p, join(dir, 'bridge.log'));
  });
});
