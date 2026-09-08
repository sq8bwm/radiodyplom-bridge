// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Rozpoznanie rodzaju instalacji.
//
// Każdy przypadek podstawiamy jawnie, bo inaczej sprawdzalibyśmy wyłącznie tę
// wersję, która akurat jest uruchomiona (czyli u nas: źródła), a chodzi
// głównie o Windowsa — instalator kontra portable.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  rodzajInstalacji, katalogDanychObokPliku, KATALOG_PRZENOSNY,
} from '../src/instalacja.js';

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

  test('status API podaje instalację razem z katalogiem obok pliku', () => {
    assert.match(H, /const r = rodzajInstalacji\(\);/);
    assert.match(H, /daneObok: d && !d\.blad \? d\.katalog : null/);
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

describe('katalog danych obok pliku programu', () => {
  const tymczasowe = [];
  const kosz = () => {
    const d = mkdtempSync(join(tmpdir(), 'rd-obok-'));
    tymczasowe.push(d);
    return d;
  };
  after(() => tymczasowe.forEach((d) => {
    try { chmodSync(d, 0o700); } catch { /* mogło zostać skasowane */ }
    rmSync(d, { recursive: true, force: true });
  }));

  test('bez portable i bez AppImage — nic nie zmieniamy', () => {
    assert.equal(katalogDanychObokPliku({ env: {} }), null);
  });

  test('portable BEZ katalogu — nic nie zmieniamy (włącza się na życzenie)', () => {
    // To jest sedno wybranego rozwiązania: samo uruchomienie portable NIE
    // rozsypuje konfiguracji tam, skąd go kliknięto (np. w „Pobranych"),
    // i nie odcina nikogo od danych, które już ma w %APPDATA%.
    const obok = kosz();
    assert.equal(katalogDanychObokPliku({ env: { PORTABLE_EXECUTABLE_DIR: obok } }), null);
  });

  test('portable Z katalogiem — dane jadą obok pliku', () => {
    const obok = kosz();
    const dane = join(obok, KATALOG_PRZENOSNY);
    mkdirSync(dane);
    const w = katalogDanychObokPliku({ env: { PORTABLE_EXECUTABLE_DIR: obok } });
    assert.equal(w.katalog, dane);
    assert.equal(w.blad, undefined);
  });

  test('AppImage Z katalogiem — liczy się katalog PLIKU, nie jego zawartości', () => {
    // APPIMAGE to ścieżka pliku, nie katalogu — pomyłka dałaby katalog danych
    // wewnątrz nieistniejącego miejsca.
    const obok = kosz();
    mkdirSync(join(obok, KATALOG_PRZENOSNY));
    const w = katalogDanychObokPliku({
      env: { APPIMAGE: join(obok, 'radiodyplom-bridge-0.1.22-x86_64.AppImage') },
    });
    assert.equal(w.katalog, join(obok, KATALOG_PRZENOSNY));
  });

  test('katalog tylko do odczytu — zgłaszamy błąd, nie udajemy sukcesu', () => {
    // Pendrive bywa zablokowany, AppImage leży czasem na nośniku RO. Cichy
    // powrót do %APPDATA% byłby gorszy: człowiek myślałby, że dane jadą z nim.
    const obok = kosz();
    const dane = join(obok, KATALOG_PRZENOSNY);
    mkdirSync(dane);
    chmodSync(dane, 0o500);
    try {
      const w = katalogDanychObokPliku({ env: { PORTABLE_EXECUTABLE_DIR: obok } });
      assert.equal(w.blad, 'tylko-do-odczytu');
      assert.equal(w.katalog, dane);
    } finally {
      chmodSync(dane, 0o700);
    }
  });
});

describe('dwie instancje obok siebie', () => {
  const M = readFileSync(new URL('../ui/main.js', import.meta.url), 'utf8');

  test('katalog danych przestawiamy PRZED blokadą jednej instancji', () => {
    // Blokada Electrona wisi na `userData`. Przestawienie katalogu PO jej
    // pobraniu nie dałoby nic: portable nadal nie dałby się uruchomić obok
    // wersji instalowanej. Kolejność jest tu całą funkcją.
    const iSet = M.indexOf("app.setPath('userData'");
    // Bez nawiasu zamykającego: od 0.1.23 blokada dostaje `additionalData`.
    const iLock = M.indexOf('app.requestSingleInstanceLock(');
    assert.ok(iSet > 0, 'brak przestawienia katalogu danych');
    assert.ok(iLock > 0, 'brak blokady jednej instancji');
    assert.ok(iSet < iLock, 'setPath MUSI być przed requestSingleInstanceLock');
  });

  test('razem z katalogiem danych ustawiamy RD_CONFIG_DIR', () => {
    // Bez tego tryb działał tylko w wersji spakowanej (gałąź `app.isPackaged`),
    // więc konfiguracja szła z innego miejsca niż dane — sprawdzone na żywym
    // programie: instancja startowała ze starym portem UDP.
    assert.match(M, /process\.env\.RD_CONFIG_DIR = daneObok\.katalog/);
  });

  test('razem z konfiguracją przestawiamy też DANE', () => {
    // Bez tego `dataDir: "auto"` wskazywał katalog systemowy i druga instancja
    // padała na blokadzie katalogu danych, mimo osobnej konfiguracji.
    assert.match(M, /process\.env\.RD_DATA_DIR = daneObok\.katalog/);
  });

  test('katalog tylko do odczytu nie przestawia niczego', () => {
    assert.match(M, /if \(daneObok\?\.katalog && !daneObok\.blad\)/);
  });
});

describe('druga instancja mówi, co się stało', () => {
  const M = readFileSync(new URL('../ui/main.js', import.meta.url), 'utf8');
  const S = readFileSync(new URL('../ui/strings.js', import.meta.url), 'utf8');

  test('pokazujemy plik KLIKNIĘTY, nie kopię z katalogu tymczasowego', () => {
    // Przy AppImage i portable `process.execPath` to `/tmp/.mount_…` albo kopia
    // w %TEMP% — ścieżka, która użytkownikowi nic nie mówi. Swoją znamy ze
    // środowiska, a drugiej instancji dowiadujemy się z `additionalData`.
    assert.match(M, /process\.env\.APPIMAGE \|\| process\.env\.PORTABLE_EXECUTABLE_FILE/);
    assert.match(M, /app\.requestSingleInstanceLock\(\{/);
    assert.match(M, /const skad = dodatkowe\?\.plik \|\| argv\?\.\[0\]/);
  });

  test('to samo kliknięcie tylko pokazuje okno, bez gadania', () => {
    // Drugie kliknięcie tej samej ikony to normalne zachowanie i nie może
    // wywoływać żadnego komunikatu.
    assert.match(M, /if \(!skad \|\| skad === mojPlik \|\| skad === process\.execPath\) return;/);
  });

  test('INNY plik programu jest wyjaśniany oknem, nie tylko logiem', () => {
    // Zgłoszone 2026-09-08: AppImage przy działającej paczce .deb „uaktywnia
    // wersję zainstalowaną", co wygląda jak niedziałający plik.
    const blok = M.slice(M.indexOf("app.on('second-instance'"));
    assert.match(blok, /dialog\.showMessageBox/);
    assert.match(blok, /secondInstance\.howTo/);
    assert.match(blok, /log\.warn/);
  });

  test('rada mówi o katalogu radiodyplom-dane i portach', () => {
    const m = S.match(/'secondInstance\.howTo': '([^']*(?:'\s*\+\s*'[^']*)*)'/);
    assert.ok(m, 'brak rady dla drugiej instancji');
    assert.match(m[1], /radiodyplom-dane/);
    assert.match(m[1], /udp\.port/);
  });

  test('teksty są w obu językach', () => {
    for (const k of ['secondInstance.title', 'secondInstance.running',
      'secondInstance.launched', 'secondInstance.howTo', 'secondInstance.ok']) {
      const ile = [...S.matchAll(new RegExp(`'${k.replace('.', '\\.')}':`, 'g'))].length;
      assert.equal(ile, 2, `${k} ma ${ile} tłumaczeń, a ma mieć 2 (pl i en)`);
    }
  });
});

describe('nieudany start rdzenia widoczny w oknie', () => {
  const M = readFileSync(new URL('../ui/main.js', import.meta.url), 'utf8');
  const R = readFileSync(new URL('../ui/renderer.js', import.meta.url), 'utf8');
  const S = readFileSync(new URL('../ui/strings.js', import.meta.url), 'utf8');

  test('powód zapamiętany i oddany przez status', () => {
    assert.match(M, /bladStartu = err\.message/);
    assert.match(M, /bladStartu \? \{ bladStartu, configFile: configPath\(\) \}/);
  });

  test('okno pokazuje powód, a nie pusty szkielet', () => {
    assert.match(R, /if \(ostatniStatus\?\.bladStartu\)/);
    assert.match(R, /startFailNote'\)\.hidden = false/);
    assert.match(R, /startFailText'\)\.textContent = s\.bladStartu/);
  });

  test('rada mówi o porcie UDP, bo to najczęstsza przyczyna', () => {
    const m = S.match(/'startFail\.hint': '([^']*(?:'\s*\+\s*'[^']*)*)'/);
    assert.ok(m, 'brak rady przy nieudanym starcie');
    assert.match(m[1], /udp\.port/);
  });

  test('teksty awarii są w obu językach', () => {
    for (const k of ['startFail.title', 'startFail.badge', 'startFail.hint', 'btn.showConfigFile']) {
      const ile = [...S.matchAll(new RegExp(`'${k.replace('.', '\\.')}':`, 'g'))].length;
      assert.equal(ile, 2, `${k} ma ${ile} tłumaczeń, a ma mieć 2 (pl i en)`);
    }
  });
});
