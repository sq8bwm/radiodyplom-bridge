// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Przycisk restartu: gdzie jest, czego wymaga i co robi na Windowsie.
//
// Restart przerywa nasłuch UDP, a QSO wysłane przez logger w tym okienku nie ma
// jak wrócić — to ten sam argument, którym odrzuciliśmy samoaktualizację.
// Dlatego testy pilnują nie tylko istnienia przycisku, ale też tego, że NIE
// stoi w nagłówku i że pyta przed zrobieniem czegokolwiek.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MAIN = readFileSync('ui/main.js', 'utf8');
const R = readFileSync('ui/renderer.js', 'utf8');
const H = readFileSync('ui/index.html', 'utf8');
const S = readFileSync('ui/strings.js', 'utf8');
const UNIT = readFileSync('dist/radiodyplom-bridge.service', 'utf8');

describe('umiejscowienie', () => {
  test('przycisk jest w banerze „wymaga restartu", nie w nagłówku', () => {
    const baner = H.slice(H.indexOf('id="restartNote"'), H.indexOf('</nav>'));
    assert.match(baner, /id="btnRestart"/, 'przycisk ma być w banerze');
    const naglowek = H.slice(H.indexOf('<header>'), H.indexOf('</header>'));
    assert.doesNotMatch(naglowek, /btnRestart/,
      'stały przycisk w nagłówku zapraszałby do restartu w trakcie akcji');
  });

  test('baner siedzi w przyklejonej części okna', () => {
    // Dzięki temu widać go także na dole długiej Konfiguracji, przy „Zapisz" —
    // to był argument za tym miejscem zamiast osobnego przycisku w panelu.
    const topbar = H.slice(H.indexOf('<div class="topbar">'), H.indexOf('<main>'));
    assert.match(topbar, /id="restartNote"/);
  });

  test('pokazywany tylko wtedy, gdy coś czeka na restart', () => {
    assert.match(R, /\$\('restartNote'\)\.hidden = pend\.length === 0/);
    assert.match(R, /\$\('btnRestart'\)\.hidden = !moznaZOkna/);
  });
});

describe('ostrzeżenie przed skutkiem', () => {
  test('restart wymaga potwierdzenia', () => {
    const blok = R.slice(R.indexOf("$('btnRestart').onclick"));
    assert.match(blok.slice(0, 400), /if \(!await ask\(t\('confirm\.restart'\)\)\) return;/);
  });

  test('treść mówi o utracie QSO, nie tylko o restarcie', () => {
    const m = S.match(/'confirm\.restart': '([^']+)'/);
    assert.ok(m, 'brak komunikatu po polsku');
    assert.match(m[1], /UDP/);
    assert.match(m[1], /NIE zostanie odebrane/);
  });
});

describe('mechanika restartu', () => {
  test('relaunch PRZED zamknięciem', () => {
    // `app.relaunch()` tylko planuje nowy proces — uruchamia go przy wyjściu.
    // Odwrotna kolejność zamknęłaby program bez restartu.
    const blok = MAIN.slice(MAIN.indexOf('function restartProgramu'));
    const iRelaunch = blok.indexOf('app.relaunch(');
    const iShutdown = blok.indexOf('shutdown(');
    assert.ok(iRelaunch > 0 && iShutdown > iRelaunch, 'relaunch musi być pierwszy');
  });

  test('idzie tą samą ścieżką co „Zakończ"', () => {
    // Inaczej restart ominąłby zamknięcie kolejki, ikony i pliku logu.
    const blok = MAIN.slice(MAIN.indexOf('function restartProgramu'));
    assert.match(blok.slice(0, 1400), /shutdown\(`restart: /);
  });

  test('Windows portable: restart wskazuje plik uruchomiony przez użytkownika', () => {
    // Wersja portable rozpakowuje się do katalogu tymczasowego, więc
    // process.execPath wskazuje kopię. Zmienną ustawia instalator portable
    // electron-buildera (sprawdzone w app-builder-lib/templates/nsis/portable.nsi).
    assert.match(MAIN, /PORTABLE_EXECUTABLE_FILE/);
    assert.match(MAIN, /app\.relaunch\(portable \? \{ execPath: portable \} : undefined\)/);
  });

  test('blokada jednej instancji zwalniana przed wyjściem', () => {
    // Bez tego nowa instancja mogła zobaczyć blokadę zajętą, zamknąć się
    // i zostawić użytkownika BEZ programu — gorzej niż brak przycisku.
    assert.match(MAIN, /releaseSingleInstanceLock\(\)/);
  });
});

describe('maszyna bez pulpitu', () => {
  test('usługa ma Restart=on-failure, więc czyste wyjście jej NIE podniesie', () => {
    // To dlatego w przeglądarce nie ma przycisku: „restart przez wyjście"
    // zatrzymałby usługę. Gdyby ktoś kiedyś zmienił to na `always`, ten test
    // przypomni, że wtedy „Zakończ" wpada w pętlę restartów.
    assert.match(UNIT, /Restart=on-failure/);
  });

  test('w przeglądarce baner podaje polecenie zamiast przycisku', () => {
    assert.match(R, /restart\.manual/);
    const m = S.match(/'restart\.manual': '([^']+)'/);
    assert.match(m[1], /systemctl restart/);
  });
});
