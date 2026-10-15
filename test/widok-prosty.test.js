// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Widok prosty: krótka strona zamiast pełnego układu z zakładkami.
//
// PO CO: pełny widok przy pierwszym uruchomieniu wygląda na coś, co trzeba
// skonfigurować — sześć zakładek, tabele, formularze — a nie trzeba: QSO lecą
// same. Widok prosty odpowiada na jedno pytanie („czy to działa?") i pokazuje
// ostatnie łączności. Pełny jest o jedno kliknięcie dalej i NIE znika.
//
// Dwie rzeczy, których te testy pilnują najmocniej, bo zepsucie ich byłoby
// niewidoczne na pierwszy rzut oka:
//   - konfiguracje bez pola `view` zostają na widoku pełnym (nikt, kto
//     pracuje z programem od miesiąca, nie prosił o schowanie mu zakładek),
//   - z widoku prostego da się wrócić i wpisać PIN — inaczej nowy użytkownik
//     utknąłby na ekranie, który nic nie robi.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editableConfig, applyConfig, writeConfigFile } from '../src/configedit.js';

const H = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
const R = readFileSync(new URL('../ui/renderer.js', import.meta.url), 'utf8');
const S = readFileSync(new URL('../ui/strings.js', import.meta.url), 'utf8');
const C = readFileSync(new URL('../src/configedit.js', import.meta.url), 'utf8');
const PRZYKLAD = JSON.parse(
  readFileSync(new URL('../config.example.json', import.meta.url), 'utf8'),
);

function swiezaKonfiguracja() {
  return {
    udp: { host: '127.0.0.1', port: 12060, multicastGroups: [] },
    radiodyplom: { apiUrl: 'https://example.invalid/x', pin: 'ABCD-1234', timeoutMs: 1000 },
    forward: { operations: ['insert'], targets: [] },
    queue: {}, rateLimit: {}, api: { enabled: false, port: 12061 },
    logLevel: 'error', language: 'pl',
  };
}

describe('wybór widoku w konfiguracji', () => {
  test('brak pola znaczy widok pełny — stare instalacje zostają, gdzie były', () => {
    assert.equal(editableConfig(swiezaKonfiguracja()).view, 'advanced');
  });

  test('nowa instalacja zaczyna od prostego', () => {
    // Wzorzec jest KOPIOWANY przy pierwszym uruchomieniu wersji instalowanej,
    // więc to jedyne miejsce, w którym „nowi dostają prosty" jest zapisane.
    assert.equal(PRZYKLAD.view, 'simple');
  });

  test('interfejs dostaje zapisany wybór', () => {
    for (const w of ['simple', 'advanced']) {
      assert.equal(editableConfig({ ...swiezaKonfiguracja(), view: w }).view, w);
    }
  });

  test('nieznana wartość nie wycieka do okna', () => {
    // Gdyby przeszła, okno schowałoby OBA widoki i zostałby sam nagłówek.
    assert.equal(editableConfig({ ...swiezaKonfiguracja(), view: 'kafelki' }).view, 'advanced');
  });

  test('zapis waliduje wobec listy', () => {
    const kat = mkdtempSync(join(tmpdir(), 'rd-widok-'));
    const bylo = process.env.RD_CONFIG_DIR;
    process.env.RD_CONFIG_DIR = kat;
    const cfg = swiezaKonfiguracja();
    const d = { cfg, client: {}, listener: {}, worker: {} };
    try {
      applyConfig(d, { view: 'simple' });
      assert.equal(cfg.view, 'simple');
      applyConfig(d, { view: 'kafelki' });
      assert.equal(cfg.view, 'advanced', 'nieznany widok ma wracać do pełnego');
    } finally {
      if (bylo === undefined) delete process.env.RD_CONFIG_DIR;
      else process.env.RD_CONFIG_DIR = bylo;
      rmSync(kat, { recursive: true, force: true });
    }
  });

  test('wybór trafia do pliku, nie tylko do pamięci', () => {
    // Ten sam regres co przy motywie i skali czcionki: writeConfigFile
    // zaczyna od rozsypania dotychczasowej treści, więc pole spoza jego listy
    // wracałoby po restarcie do poprzedniej wartości.
    //
    // Zapis idzie do katalogu tymczasowego, bo bez RD_CONFIG_DIR ta funkcja
    // nadpisuje config.json w katalogu repozytorium — czyli czyjąś roboczą
    // konfigurację. (Złapane przy pisaniu tego testu.)
    const kat = mkdtempSync(join(tmpdir(), 'rd-widok-'));
    const bylo = process.env.RD_CONFIG_DIR;
    process.env.RD_CONFIG_DIR = kat;
    try {
      writeConfigFile({ ...swiezaKonfiguracja(), view: 'simple' });
      const zPliku = JSON.parse(readFileSync(join(kat, 'config.json'), 'utf8'));
      assert.equal(zPliku.view, 'simple');
    } finally {
      if (bylo === undefined) delete process.env.RD_CONFIG_DIR;
      else process.env.RD_CONFIG_DIR = bylo;
      rmSync(kat, { recursive: true, force: true });
    }
    assert.match(C.slice(C.indexOf('export function writeConfigFile')), /view: cfg\.view/);
  });

  test('zmiana widoku NIE wymaga restartu', () => {
    // To ustawienie okna, nie gniazda. Gdyby trafiło na listę restartową,
    // kliknięcie przełącznika zapalałoby belkę „wymaga restartu".
    const blok = C.slice(C.indexOf('const RESTART_KEYS'), C.indexOf('const RESTART_KEYS') + 600);
    assert.ok(!/'view'/.test(blok), 'view nie ma prawa być na liście restartowej');
  });
});

describe('okno: dwa widoki i droga między nimi', () => {
  test('widok prosty jest osobnym blokiem, domyślnie ukrytym w pliku', () => {
    // `hidden` w pliku, a nie w kodzie: dopóki renderer nie wczyta wyboru
    // z konfiguracji, nie wolno mignąć widokiem, którego użytkownik nie wybrał.
    assert.match(H, /<main id="prosty" hidden>/);
    assert.match(H, /<main id="pelny">/);
  });

  test('przełącznik stoi w nagłówku, obok „Wstrzymaj"', () => {
    const naglowek = H.slice(H.indexOf('<header>'), H.indexOf('</header>'));
    assert.ok(naglowek.includes('id="btnPause"'), 'brak przycisku pauzy w nagłówku');
    assert.ok(naglowek.includes('id="btnWidok"'), 'brak przełącznika widoku w nagłówku');
  });

  test('napis na przełączniku mówi, dokąd prowadzi — w obie strony', () => {
    // Bez drugiego napisu widok prosty byłby pułapką bez wyjścia.
    assert.match(R, /btn\.advanced/);
    assert.match(R, /btn\.simpleView/);
    for (const k of ['btn.advanced', 'btn.simpleView']) {
      assert.ok(S.includes(`'${k}':`), `brak tłumaczenia ${k}`);
    }
  });

  test('widok prosty chowa pasek zakładek', () => {
    // Sam pasek zakładek był połową tego, co wyglądało na skomplikowane.
    const blok = R.slice(R.indexOf('function zastosujWidok'), R.indexOf('function buildWidokButton'));
    assert.match(blok, /querySelector\('nav'\)/);
    assert.match(blok, /nav\.hidden = prosty/);
  });

  test('przełączenie zapisuje wybór, żeby przetrwało restart', () => {
    const blok = R.slice(R.indexOf('function buildWidokButton'), R.indexOf('function buildWidokButton') + 500);
    assert.match(blok, /saveConfig\(\{ view: nast \}\)/);
  });

  test('okno startuje w widoku z konfiguracji, a bez niego — w pełnym', () => {
    assert.match(R, /buildWidokButton\(cfg\?\.view \|\| 'advanced'\)/);
  });
});

describe('co widać w widoku prostym', () => {
  const blok = R.slice(R.indexOf('function renderProsty'), R.indexOf('$(\'btnProstyPin\')'));

  test('jedna linijka stanu zamiast panelu', () => {
    // Panel zabierał trzecią część ekranu, żeby powiedzieć „działa".
    assert.match(H, /<div class="linijka" id="prostyStan">/);
    assert.match(R, /function prostyStan/);
  });

  test('próba na sucho wygrywa z „działa"', () => {
    // Przy dry-run NIC nie wychodzi z komputera, więc zielone „działa"
    // byłoby nieprawdą — a to jedyne zdanie na tej stronie.
    const st = R.slice(R.indexOf('function prostyStan'), R.indexOf('function renderProsty'));
    assert.ok(st.indexOf('dryRun') < st.indexOf('failed'), 'dry-run ma być sprawdzany przed odrzuconymi');
  });

  test('lista pokazuje łączności, nie komunikaty, i najwyżej dziesięć', () => {
    assert.match(blok, /kind === 'sent'/);
    assert.match(blok, /slice\(0, 10\)/);
  });

  test('„czeka" świeci na żółto tylko wtedy, gdy naprawdę coś czeka', () => {
    assert.match(blok, /czeka > 0 \? ' czeka' : ''/);
  });

  test('liczba „z dzisiaj" idzie z dziennika i liczy dzień w UTC', () => {
    // Doba amatorska jest w UTC — tak samo liczy zakres „dziś" na
    // Statystykach, więc obie liczby muszą się wieczorem zgadzać.
    const d = R.slice(R.indexOf('async function odswiezDzisiaj'), R.indexOf('function prostyStan'));
    assert.match(d, /toISOString\(\)\.slice\(0, 10\)/);
    assert.match(d, /bridge\.stats/);
  });

  test('liczba „z dzisiaj" rusza od razu po wysyłce, nie po pół minuty', () => {
    // Inaczej QSO było już na liście, a liczba nad nią stała na zerze
    // i wyglądała na zepsutą. Sygnałem jest drgnięcie licznika wysyłek.
    assert.match(R, /dzisiajPoWysylce !== null && wyslaneTeraz !== dzisiajPoWysylce/);
    assert.match(R, /odswiezDzisiaj\(cosPoszlo\)/);
  });

  test('„z dzisiaj" odświeża się dla OBU widoków, nie tylko prostego', () => {
    // Ta sama liczba stoi teraz na kafelku „Wysłane dziś" w widoku pełnym,
    // więc odczyt dziennika musi być we wspólnej ścieżce — w `renderProsty`
    // nie zdążyłby, bo ta wychodzi od razu, gdy widok jest pełny.
    const d = R.slice(R.indexOf('async function odswiezDzisiaj'), R.indexOf('function prostyStan'));
    assert.doesNotMatch(d, /widok !== 'simple'/,
      'odczyt „dziś" nie może być zamknięty w widoku prostym');
    assert.match(d, /\$\('cSent'\)\.textContent = tekst;/);
    assert.match(d, /\$\('prostySent'\)\.textContent = tekst;/);
  });
});

describe('PIN da się wpisać bez wchodzenia w Konfigurację', () => {
  test('belka z polem i przyciskiem jest w widoku prostym', () => {
    const prosty = H.slice(H.indexOf('<main id="prosty"'), H.indexOf('<main id="pelny">'));
    assert.ok(prosty.includes('id="prostyPinInput"'), 'brak pola PIN-u');
    assert.ok(prosty.includes('id="btnProstyPin"'), 'brak przycisku zapisu');
  });

  test('belka pokazuje się tylko przy braku PIN-u i gasi linijkę stanu', () => {
    // Dwa komunikaty o tym samym obok siebie to szum, a ten widok ma mieć
    // jedną rzecz do przeczytania.
    const blok = R.slice(R.indexOf('function renderProsty'), R.indexOf('$(\'btnProstyPin\')'));
    assert.match(blok, /pinMissing/);
    assert.match(blok, /\$\('prostyStan'\)\.hidden = brakPin/);
  });

  test('zapisuje PIN tą samą drogą co Konfiguracja', () => {
    const blok = R.slice(R.indexOf("$('btnProstyPin')"), R.indexOf("$('prostyPinInput').onkeydown"));
    assert.match(blok, /saveConfig\(\{ radiodyplom: \{ pin \} \}\)/);
  });

  test('Enter w polu robi to samo co przycisk', () => {
    assert.match(R, /prostyPinInput'\)\.onkeydown/);
  });
});

describe('teksty widoku prostego', () => {
  test('są w obu językach', () => {
    // Komplet kluczy pilnuje strings.test.js; tutaj sprawdzamy, że te
    // konkretne w ogóle powstały.
    for (const k of ['prosty.ok', 'prosty.paused', 'prosty.offline', 'prosty.dry',
      'prosty.sentToday', 'prosty.pending', 'prosty.lastQso', 'prosty.empty',
      'prosty.pinTitle', 'prosty.pinText']) {
      assert.ok(S.includes(`'${k}':`), `brak klucza ${k}`);
    }
  });

  test('wyjaśnienie liczb siedzi w dymku, nie na ekranie', () => {
    // Marek: kafelki mają pokazywać samą liczbę — opis zajmował więcej
    // miejsca niż to, co opisywał.
    assert.match(R, /prosty\.tipSentToday/);
    assert.match(R, /prosty\.tipPending/);
    const prosty = H.slice(H.indexOf('<main id="prosty"'), H.indexOf('<main id="pelny">'));
    assert.ok(!prosty.includes('class="s"'), 'kafelki w widoku prostym nie mają trzeciej linii');
  });
});

// Zgłoszone 2026-10-15 przy czytaniu dwóch zrzutów obok siebie: „martwi mnie,
// że w widoku uproszczonym mamy informację, której nie ma w pełnym". Liczba
// z dzisiaj BYŁA w pełnym — na Statystykach, po przestawieniu zakresu na
// „Dziś" — ale dwa kliknięcia dalej i pod inną nazwą.
describe('„dziś" znaczy to samo w obu widokach', () => {
  const R2 = readFileSync(new URL('../ui/renderer.js', import.meta.url), 'utf8');
  const S2 = readFileSync(new URL('../ui/strings.js', import.meta.url), 'utf8');
  const karty = R2.slice(R2.indexOf('function renderCards'), R2.indexOf("$('cPending')"));

  test('pierwsza karta na QSOs NIE pokazuje już licznika trwałego', () => {
    assert.doesNotMatch(karty, /\$\('cSent'\)\.textContent = s\.queue\.sent/,
      'liczba główna ma iść z dziennika, nie z licznika od początku');
  });

  test('licznik trwały nie zniknął — zszedł do drugiej linii', () => {
    assert.match(karty, /t\('sub\.sentTotal'\)\.replace\('\{n\}', s\.queue\.sent\)/);
    assert.match(karty, /sub\.sentSession/);
  });

  test('podpowiedź tłumaczy, skąd liczba i za jaką dobę', () => {
    assert.match(karty, /tip\.sentToday/);
    // Tekst jest sklejony z kilku linii, więc bierzemy KAWAŁEK PLIKU od klucza,
    // a nie pierwszy fragment w apostrofach — inaczej test sprawdzałby
    // pierwsze pół zdania i przepuszczał resztę.
    const i = S2.indexOf("'tip.sentToday'");
    const pl = S2.slice(i, i + 500);
    assert.match(pl, /UTC/);
    assert.match(pl, /dziennik/i);
  });

  test('podpis karty jest w obu językach', () => {
    assert.equal(S2.split("'card.sentToday'").length - 1, 2);
  });

  test('druga linia nie odmienia rzeczownika przez liczebnik', () => {
    // „w tej sesji: 1 kopii" to błąd, „2 kopii" też — polski liczebnik rządzi
    // odmianą, a my nie mamy czym jej robić. Stąd zapis etykietowy.
    for (const klucz of ['sub.sentTotal', 'sub.sentSession']) {
      for (const m of S2.matchAll(new RegExp(`'${klucz.replace('.', '\\.')}': '([^']+)'`, 'g'))) {
        assert.doesNotMatch(m[1], /\{n\} (kopii|kopie|kopia)/,
          `${klucz}: „${m[1]}" odmienia rzeczownik po liczbie`);
      }
    }
  });
});
