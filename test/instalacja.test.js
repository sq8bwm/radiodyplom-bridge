// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Rozpoznanie rodzaju instalacji.
//
// Każdy przypadek podstawiamy jawnie, bo inaczej sprawdzalibyśmy wyłącznie tę
// wersję, która akurat jest uruchomiona (czyli u nas: źródła), a chodzi
// głównie o Windowsa — instalator kontra portable.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync, mkdtempSync, mkdirSync, rmSync, chmodSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  rodzajInstalacji, katalogDanychObokPliku, KATALOG_PRZENOSNY,
  wolnaParaPortow, zalozKatalogDanych, dostosujPortyPrzyZasiewie,
} from '../src/instalacja.js';
import { examplePath, DOMYSLNY_PORT_UDP } from '../src/config.js';

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
    assert.match(blok, /zapytajODrugaInstancje\(\{ skad, ja, on \}\)/);
    assert.match(blok, /log\.warn/);
    // Pytanie samo w sobie jest w funkcji pomocniczej — sprawdzane osobno.
    assert.match(M, /async function zapytajODrugaInstancje/);
    assert.match(M, /dialog\.showMessageBox/);
  });

  test('to PYTANIE z dwiema odpowiedziami, nie komunikat', () => {
    // Obie odpowiedzi są sensowne: zwykle chce się pracować dalej na tej
    // instancji, która działa, ale czasem właśnie po to kliknięto drugi plik.
    const blok = M.slice(M.indexOf('async function zapytajODrugaInstancje'));
    assert.match(blok, /type: 'question'/);
    assert.match(blok, /buttons: \[t\('secondInstance\.keep'\), t\('secondInstance\.create'\)\]/);
    assert.match(blok, /if \(wybor\.response !== 1\) return;/);
  });

  test('Escape znaczy „nic nie zmieniaj"', () => {
    // Zakładanie katalogu obok pliku nie może być skutkiem zamknięcia okna.
    const blok = M.slice(M.indexOf('async function zapytajODrugaInstancje'));
    assert.match(blok, /defaultId: 0/);
    assert.match(blok, /cancelId: 0/);
  });

  test('po założeniu katalogu druga instancja jest uruchamiana na nowo', () => {
    // Ta, która pytała, już się zamknęła (nie dostała blokady), więc bez
    // ponownego uruchomienia człowiek musiałby kliknąć plik jeszcze raz.
    const blok = M.slice(M.indexOf('async function zapytajODrugaInstancje'));
    assert.match(blok, /spawn\(skad, \[\], \{ detached: true, stdio: 'ignore' \}\)\.unref\(\)/);
  });

  test('pytanie mówi o katalogu radiodyplom-dane', () => {
    const m = S.match(/'secondInstance\.question': '([^']*(?:'\s*\+\s*'[^']*)*)'/);
    assert.ok(m, 'brak pytania dla drugiej instancji');
    assert.match(m[1], /radiodyplom-dane/);
  });

  test('teksty są w obu językach', () => {
    for (const k of ['secondInstance.title', 'secondInstance.running',
      'secondInstance.launched', 'secondInstance.question', 'secondInstance.keep',
      'secondInstance.create', 'secondInstance.createdTitle', 'secondInstance.ports',
      'secondInstance.createdHint', 'secondInstance.failedTitle',
      'secondInstance.failedHint', 'secondInstance.ok']) {
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

describe('zakładanie katalogu na dane na życzenie', () => {
  const tymczasowe = [];
  const kosz = () => {
    const d = mkdtempSync(join(tmpdir(), 'rd-zaloz-'));
    tymczasowe.push(d);
    return d;
  };
  after(() => tymczasowe.forEach((d) => {
    try { chmodSync(d, 0o700); } catch { /* mogło zostać skasowane */ }
    rmSync(d, { recursive: true, force: true });
  }));

  test('wolna para portów: UDP i o jeden wyżej interfejs', async () => {
    const p = await wolnaParaPortow();
    assert.ok(p, 'nie znalazłam wolnej pary portów');
    assert.equal(p.api, p.udp + 1);
    assert.ok(p.udp >= 12070, `pierwsza para ma być od 12070, jest ${p.udp}`);
  });

  test('zajęty port jest pomijany', async () => {
    // Sedno sprawy: bez tego świeża konfiguracja dostawała 12060 — port
    // instancji, która już działa — i druga instancja padała na starcie.
    const { createSocket } = await import('node:dgram');
    const zajete = createSocket('udp4');
    await new Promise((r) => zajete.bind({ address: '127.0.0.1', port: 12070 }, r));
    try {
      const p = await wolnaParaPortow();
      assert.notEqual(p.udp, 12070, 'zajęty port nie może zostać wybrany');
    } finally {
      zajete.close();
    }
  });

  test('zakłada katalog i wpisuje konfigurację z wolnymi portami', async () => {
    const obok = kosz();
    const plik = join(obok, 'radiodyplom-bridge-portable.exe');
    writeFileSync(plik, 'udawany plik programu');
    const w = await zalozKatalogDanych({ plik, przykladowy: examplePath() });
    assert.equal(w.katalog, join(obok, KATALOG_PRZENOSNY));
    assert.equal(w.byloJuz, false);
    const cfg = JSON.parse(readFileSync(join(w.katalog, 'config.json'), 'utf8'));
    assert.equal(cfg.udp.port, w.porty.udp);
    assert.equal(cfg.api.port, w.porty.api);
    // PIN-u NIE kopiujemy z działającej instancji — katalog bywa na pendrivie.
    assert.equal(cfg.radiodyplom.pin, 'WSTAW-PIN');
    assert.equal(cfg.radiodyplom.dryRun, true);
  });

  test('istniejącej konfiguracji nie ruszamy', async () => {
    const obok = kosz();
    const plik = join(obok, 'portable.exe');
    writeFileSync(plik, 'x');
    const katalog = join(obok, KATALOG_PRZENOSNY);
    mkdirSync(katalog);
    writeFileSync(join(katalog, 'config.json'), '{"moje":"ustawienia"}');
    const w = await zalozKatalogDanych({ plik, przykladowy: examplePath() });
    assert.equal(w.byloJuz, true);
    assert.equal(readFileSync(join(katalog, 'config.json'), 'utf8'), '{"moje":"ustawienia"}');
  });

  test('brak prawa zapisu obok pliku kończy się wyjątkiem, nie ciszą', async () => {
    const obok = kosz();
    const plik = join(obok, 'portable.exe');
    writeFileSync(plik, 'x');
    chmodSync(obok, 0o500);
    try {
      await assert.rejects(() => zalozKatalogDanych({ plik, przykladowy: examplePath() }));
    } finally {
      chmodSync(obok, 0o700);
    }
  });
});

describe('porty przy pierwszym uruchomieniu', () => {
  const tymczasowe = [];
  const kosz = () => {
    const d = mkdtempSync(join(tmpdir(), 'rd-porty-'));
    tymczasowe.push(d);
    return d;
  };
  after(() => tymczasowe.forEach((d) => rmSync(d, { recursive: true, force: true })));

  const zasiej = (porty) => {
    const dir = kosz();
    const cfg = JSON.parse(readFileSync(examplePath(), 'utf8'));
    if (porty) { cfg.udp.port = porty.udp; cfg.api.port = porty.api; }
    const plik = join(dir, 'config.json');
    writeFileSync(plik, JSON.stringify(cfg, null, 2));
    return plik;
  };

  test('domyślny port wolny — nie ruszamy niczego', async () => {
    // Cicha zmiana portu przy wolnym domyślnym byłaby szkodliwa: dokumentacja
    // i logger mówią 12060.
    const plik = zasiej({ udp: 12190, api: 12191 });
    const przed = readFileSync(plik, 'utf8');
    assert.equal(await dostosujPortyPrzyZasiewie(plik), null);
    assert.equal(readFileSync(plik, 'utf8'), przed, 'plik miał zostać nietknięty');
  });

  test('zajęty port UDP — konfiguracja dostaje inny, zapisany na dysk', async () => {
    const { createSocket } = await import('node:dgram');
    // Zajmujemy TAK, JAK NASZ MOSTEK: z reuseAddr. Właśnie ten przypadek jest
    // groźny, bo sonda z reuseAddr uznałaby taki port za wolny.
    const zajete = createSocket({ type: 'udp4', reuseAddr: true });
    await new Promise((r) => zajete.bind({ address: '127.0.0.1', port: 12180 }, r));
    try {
      const plik = zasiej({ udp: 12180, api: 12181 });
      const porty = await dostosujPortyPrzyZasiewie(plik);
      assert.ok(porty, 'porty miały zostać dobrane');
      assert.notEqual(porty.udp, 12180);
      assert.equal(porty.api, porty.udp + 1);
      const cfg = JSON.parse(readFileSync(plik, 'utf8'));
      assert.equal(cfg.udp.port, porty.udp, 'nowy port musi trafić do pliku');
      assert.equal(cfg.api.port, porty.api);
    } finally {
      zajete.close();
    }
  });

  test('sonda UDP nie może używać reuseAddr', async () => {
    // Zmierzone: z reuseAddr port trzymany przez nasz mostek wychodzi „wolny".
    const A = readFileSync(new URL('../src/instalacja.js', import.meta.url), 'utf8');
    const blok = A.slice(A.indexOf('const wolnyUdp'), A.indexOf('export async function wolnaParaPortow'));
    assert.doesNotMatch(blok, /reuseAddr:\s*true/, 'sonda z reuseAddr nie wykryje zajętego portu');
    assert.match(blok, /createSocket\('udp4'\)/);
  });

  test('nieczytelna konfiguracja nie wywala startu', async () => {
    const dir = kosz();
    const plik = join(dir, 'config.json');
    writeFileSync(plik, 'to nie jest JSON');
    assert.equal(await dostosujPortyPrzyZasiewie(plik), null);
  });

  test('porty ruszamy TYLKO przy zasiewie', () => {
    // Gdyby to chodziło przy każdym starcie, zmiana portu przez użytkownika
    // byłaby cicho nadpisywana.
    const M = readFileSync(new URL('../ui/main.js', import.meta.url), 'utf8');
    assert.match(M, /if \(ensureConfig\(\)\) \{\n\s*const porty = await dostosujPortyPrzyZasiewie/);
  });

  test('domyślny port zgadza się z szablonem konfiguracji', () => {
    // Dwa źródła prawdy: stała w kodzie i config.example.json. Rozjechanie się
    // dałoby w oknie ostrzeżenie „inny port" przy najzwyklejszej instalacji.
    const cfg = JSON.parse(readFileSync(examplePath(), 'utf8'));
    assert.equal(DOMYSLNY_PORT_UDP, cfg.udp.port);
  });

  test('okno mówi, gdy port jest inny niż domyślny', () => {
    const R = readFileSync(new URL('../ui/renderer.js', import.meta.url), 'utf8');
    const S = readFileSync(new URL('../ui/strings.js', import.meta.url), 'utf8');
    const H = readFileSync(new URL('../src/httpapi.js', import.meta.url), 'utf8');
    assert.match(H, /domyslnyPort: this\.listener\.port === DOMYSLNY_PORT_UDP/);
    assert.match(R, /inny\.hidden = s\.listener\.domyslnyPort !== false/);
    const ile = [...S.matchAll(/'note\.otherPort':/g)].length;
    assert.equal(ile, 2, `note.otherPort ma ${ile} tłumaczeń, a ma mieć 2 (pl i en)`);
  });
});
