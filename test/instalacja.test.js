// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Rozpoznanie rodzaju instalacji.
//
// Każdy przypadek podstawiamy jawnie, bo inaczej sprawdzalibyśmy wyłącznie tę
// wersję, która akurat jest uruchomiona (czyli u nas: źródła), a chodzi
// głównie o Windowsa — instalator kontra portable.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { rodzajInstalacji } from '../src/instalacja.js';

const ELECTRON = { electron: '44.0.0', defaultApp: undefined };

describe('rodzaj instalacji', () => {
  test('Windows: portable rozpoznawane po zmiennej instalatora', () => {
    const w = rodzajInstalacji({
      ...ELECTRON,
      platform: 'win32',
      execPath: 'C:\\Users\\Admin\\AppData\\Local\\Temp\\XYZ\\radiodyplom-bridge.exe',
      env: { PORTABLE_EXECUTABLE_FILE: 'D:\\radio\\radiodyplom-bridge-0.1.21-x64-portable.exe' },
    });
    assert.equal(w.rodzaj, 'portable');
    // Sama nazwa pliku, bez ścieżki — po to, żeby dało się odpowiedzieć na
    // pytanie „który plik wystartował", a nie pokazywać katalogów użytkownika.
    assert.equal(w.plik, 'radiodyplom-bridge-0.1.21-x64-portable.exe');
  });

  test('Windows: instalator', () => {
    const w = rodzajInstalacji({
      ...ELECTRON,
      platform: 'win32',
      execPath: 'C:\\Program Files\\RadioDyplom Bridge\\radiodyplom-bridge.exe',
      env: {},
    });
    assert.equal(w.rodzaj, 'instalator');
    assert.equal(w.plik, null);
  });

  test('portable ma pierwszeństwo nad instalatorem', () => {
    // Portable rozpakowuje się do katalogu tymczasowego i JEST spakowany, więc
    // rozpoznany po samym `execPath` wyszedłby jako instalator.
    const w = rodzajInstalacji({
      ...ELECTRON,
      platform: 'win32',
      execPath: 'C:\\Users\\Admin\\AppData\\Local\\Temp\\1\\radiodyplom-bridge.exe',
      env: { PORTABLE_EXECUTABLE_FILE: 'C:\\pobrane\\portable.exe' },
    });
    assert.equal(w.rodzaj, 'portable');
  });

  test('Linux: AppImage po zmiennej środowiska', () => {
    const w = rodzajInstalacji({
      ...ELECTRON,
      platform: 'linux',
      execPath: '/tmp/.mount_radioAbC/radiodyplom-bridge',
      env: { APPIMAGE: '/home/marek/Pobrane/radiodyplom-bridge-0.1.21-x86_64.AppImage' },
    });
    assert.equal(w.rodzaj, 'appimage');
    assert.equal(w.plik, 'radiodyplom-bridge-0.1.21-x86_64.AppImage');
  });

  test('Linux: paczka .deb leży w /opt', () => {
    const w = rodzajInstalacji({
      ...ELECTRON,
      platform: 'linux',
      execPath: '/opt/RadioDyplom Bridge/radiodyplom-bridge',
      env: {},
    });
    assert.equal(w.rodzaj, 'deb');
  });

  test('okno uruchomione ze źródeł (npm run ui)', () => {
    const w = rodzajInstalacji({
      electron: '44.0.0',
      defaultApp: true,
      platform: 'linux',
      execPath: '/home/marek/projekt/node_modules/electron/dist/electron',
      env: {},
    });
    assert.equal(w.rodzaj, 'zrodla');
  });

  test('usługa z paczki bez interfejsu — bez Electrona, z /usr/lib', () => {
    const w = rodzajInstalacji({
      electron: undefined,
      platform: 'linux',
      execPath: '/usr/bin/node',
      env: {},
      katalog: '/usr/lib/radiodyplom-bridge/src/',
    });
    assert.equal(w.rodzaj, 'headless');
  });

  test('rdzeń ze źródeł — bez Electrona, spoza /usr/lib', () => {
    const w = rodzajInstalacji({
      electron: undefined,
      platform: 'linux',
      execPath: '/usr/bin/node',
      env: {},
      katalog: '/home/marek/projekt/src/',
    });
    assert.equal(w.rodzaj, 'zrodla');
  });

  test('na tej maszynie odpowiada bez wyjątku i zna swój rodzaj', () => {
    // Wywołanie bez parametrów to jedyna droga używana w produkcji.
    const w = rodzajInstalacji();
    assert.ok(w.rodzaj, 'rodzaj nie może być pusty');
    assert.ok(!('undefined' in w), 'brak dziwnych pól');
  });
});

describe('rodzaj instalacji dociera do człowieka', () => {
  const H = readFileSync(new URL('../src/httpapi.js', import.meta.url), 'utf8');
  const R = readFileSync(new URL('../ui/renderer.js', import.meta.url), 'utf8');
  const S = readFileSync(new URL('../ui/strings.js', import.meta.url), 'utf8');
  const Z = readFileSync(new URL('../src/report.js', import.meta.url), 'utf8');

  test('status API podaje instalację', () => {
    assert.match(H, /instalacja: rodzajInstalacji\(\)/);
  });

  test('zakładka „O programie" pokazuje wiersz', () => {
    assert.match(R, /\[t\('about\.install'\), instalacjaOpis\(s\.instalacja\)\]/);
  });

  test('zgłoszenie błędu wiezie rodzaj, ale NIE ścieżkę', () => {
    assert.match(Z, /instalacja: rodzajInstalacji\(\)\.rodzaj/);
    assert.doesNotMatch(Z, /rodzajInstalacji\(\)\.plik/, 'ścieżka to nazwa katalogu użytkownika');
  });

  test('każdy rodzaj ma tłumaczenie w obu językach', () => {
    // Drift: dodanie rodzaju w src bez tłumaczenia dałoby w oknie surowy klucz.
    const A = readFileSync(new URL('../src/instalacja.js', import.meta.url), 'utf8');
    const rodzaje = [...A.matchAll(/rodzaj: '([a-z]+)'/g)].map((m) => m[1]);
    assert.ok(rodzaje.length >= 7, `oczekiwałam siedmiu rodzajów, mam ${rodzaje.length}`);
    for (const r of new Set(rodzaje)) {
      const ile = [...S.matchAll(new RegExp(`'install\\.${r}':`, 'g'))].length;
      assert.equal(ile, 2, `rodzaj ${r} ma ${ile} tłumaczeń, a ma mieć 2 (pl i en)`);
    }
  });
});
