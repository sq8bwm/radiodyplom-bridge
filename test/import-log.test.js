// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Odtwarzanie dziennika z logów (src/tools/import-log.js).
//
// Parowanie linii jest tu najtrudniejsze: jedno QSO daje N wpisów „Nowe QSO"
// (po jednym na cel) i N potwierdzeń „zapisane", a potwierdzenie niesie tylko
// znak korespondenta — bez znaku stacji. Do tego trzeba odsiać przejścia
// próbne, które do wersji 0.1.6 meldowały się jako „zapisane".
//
// Narzędzie uruchamiamy jako proces, bo tak będzie używane.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { readRecords } from '../src/journal.js';

const NARZEDZIE = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'tools', 'import-log.js');

let dir; let logPath;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rd-import-'));
  logPath = join(dir, 'test.log');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Uruchomienie narzędzia; zwraca {wyjscie, kod}. */
function importuj(...args) {
  const r = spawnSync(process.execPath, [NARZEDZIE, '--dir', join(dir, 'sent'), ...args, logPath],
    { encoding: 'utf8' });
  return { wyjscie: (r.stdout || '') + (r.stderr || ''), kod: r.status };
}

const LOG = [
  // Jedno QSO na trzy stacje: trzy wpisy, potem trzy potwierdzenia.
  '2026-09-03T20:30:01.145Z [INFO] Nowe QSO [QLog]: SP8PKX → SQ8BWM {"band":"80m","mode":"SSB","operator":"SQ8BWM"}',
  '2026-09-03T20:30:01.145Z [INFO] Nowe QSO [QLog]: SP8PKX → SQ8BWA {"band":"80m","mode":"SSB","operator":"SQ8BWA"}',
  '2026-09-03T20:30:01.146Z [INFO] Nowe QSO [QLog]: SP8PKX → SN8N {"band":"80m","mode":"SSB","operator":"SQ8BWA"}',
  '2026-09-03T20:30:02.246Z [INFO] QSO SP8PKX zapisane {"akcje":[295],"source":"QLog"}',
  '2026-09-03T20:30:03.151Z [INFO] QSO SP8PKX zapisane {"akcje":[295],"source":"QLog"}',
  '2026-09-03T20:30:04.143Z [INFO] QSO SP8PKX zapisane {"akcje":[295],"source":"QLog"}',
  // Szum, którego nie wolno wciągnąć.
  '2026-09-03T20:31:00.000Z [INFO] Konfiguracja zapisana {"path":"/x"}',
  '2026-09-03T20:31:10.000Z [WARN] Utracono łączność z API: Błąd połączenia',
].join('\n');

describe('import-log', () => {
  test('trzy kopie jednego QSO, z pasmem, emisją i operatorem', () => {
    writeFileSync(logPath, `${LOG}\n`);
    const { kod, wyjscie } = importuj();
    assert.equal(kod, 0, wyjscie);

    const r = readRecords(join(dir, 'sent'));
    assert.equal(r.length, 3);
    assert.deepEqual(r.map((x) => x.station).sort(), ['SN8N', 'SQ8BWA', 'SQ8BWM']);
    assert.equal(r[0].band, '80m');
    assert.equal(r[0].mode, 'SSB');
    assert.deepEqual(r[0].actions, ['295']);
    assert.equal(r[0].imported, true, 'wpis ma być oznaczony jako odtworzony');
  });

  test('wszystkie kopie mają tę samą minutę, więc to JEDNO QSO', () => {
    // Potwierdzenia przychodzą sekundę po sekundzie. Gdyby czas brać z nich,
    // jedno QSO policzyłoby się jako trzy.
    writeFileSync(logPath, `${LOG}\n`);
    importuj();
    const r = readRecords(join(dir, 'sent'));
    assert.equal(new Set(r.map((x) => `${x.date}|${x.time}|${x.call}`)).size, 1);
  });

  test('przejście próbne jest pomijane', () => {
    // Do 0.1.6 tryb próbny meldował się jako „zapisane", tylko bez pola akcje.
    const log = [
      '2026-08-31T20:26:10.655Z [INFO] Nowe QSO [QLog]: SN0TST → SN0LPU {"band":"80m","mode":"SSB","operator":"SQ8BWA"}',
      '2026-08-31T20:26:11.296Z [INFO] [dry-run] POST pominięty {"callsign":"SN0TST","band":"80m"}',
      '2026-08-31T20:26:11.296Z [INFO] QSO SN0TST zapisane {"source":"QLog"}',
    ].join('\n');
    writeFileSync(logPath, `${log}\n`);
    const { wyjscie } = importuj();
    assert.match(wyjscie, /przejścia próbne\s*:\s*1/);
    assert.deepEqual(readRecords(join(dir, 'sent')), []);
  });

  test('przejście próbne nie kradnie pary następnemu QSO', () => {
    // Gdyby „Nowe QSO" próbnego zostało w kolejce, sparowałoby się z kolejnym
    // potwierdzeniem i przypisało mu zły znak stacji.
    const log = [
      '2026-08-31T20:26:10.000Z [INFO] Nowe QSO [QLog]: SP1AAA → SN0LPU {"band":"80m","mode":"SSB","operator":"A"}',
      '2026-08-31T20:26:11.000Z [INFO] [dry-run] POST pominięty {"callsign":"SP1AAA"}',
      '2026-08-31T20:26:11.100Z [INFO] QSO SP1AAA zapisane {"source":"QLog"}',
      '2026-08-31T20:30:00.000Z [INFO] Nowe QSO [QLog]: SP1AAA → SQ8BWM {"band":"40m","mode":"CW","operator":"B"}',
      '2026-08-31T20:30:01.000Z [INFO] QSO SP1AAA zapisane {"akcje":[295],"source":"QLog"}',
    ].join('\n');
    writeFileSync(logPath, `${log}\n`);
    importuj();
    const r = readRecords(join(dir, 'sent'));
    assert.equal(r.length, 1);
    assert.equal(r[0].station, 'SQ8BWM', 'druga kopia, nie ta z przejścia próbnego');
    assert.equal(r[0].band, '40m');
  });

  test('powtórny import nie dubluje wpisów', () => {
    writeFileSync(logPath, `${LOG}\n`);
    importuj();
    const { wyjscie } = importuj();
    assert.match(wyjscie, /już w dzienniku\s*:\s*3/);
    assert.equal(readRecords(join(dir, 'sent')).length, 3, 'nadal trzy, nie sześć');
  });

  test('--dry nic nie zapisuje', () => {
    writeFileSync(logPath, `${LOG}\n`);
    const { wyjscie } = importuj('--dry');
    assert.match(wyjscie, /do zapisu\s*:\s*3/);
    assert.deepEqual(readRecords(join(dir, 'sent')), []);
  });

  test('--skip-call wyrzuca wskazany znak', () => {
    writeFileSync(logPath, `${LOG}\n`);
    const { wyjscie } = importuj('--skip-call', 'sp8pkx');
    assert.match(wyjscie, /pominięte znaki\s*:\s*3/);
    assert.deepEqual(readRecords(join(dir, 'sent')), []);
  });

  test('potwierdzenie bez pary jest zgłaszane, nie zgadywane', () => {
    // Bywa na początku uciętego logu albo gdy QSO przeszło z poprzedniej sesji.
    // Znaku stacji nie mamy skąd wziąć, więc wpisu NIE tworzymy.
    const log = '2026-09-03T20:30:02.246Z [INFO] QSO SP8PKX zapisane {"akcje":[295],"source":"QLog"}';
    writeFileSync(logPath, `${log}\n`);
    const { wyjscie } = importuj();
    assert.match(wyjscie, /bez pary\s*:\s*1/);
    assert.deepEqual(readRecords(join(dir, 'sent')), []);
  });

  test('brak plików na wejściu kończy się błędem, nie ciszą', () => {
    const r = spawnSync(process.execPath, [NARZEDZIE, '--dir', join(dir, 'sent')], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Podaj co najmniej jeden plik/);
  });
});
