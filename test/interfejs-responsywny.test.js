// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Układ na wąskim ekranie (telefon).
//
// To samo `index.html` jedzie w oknie Electrona i w przeglądarce — także
// z telefonu, odkąd interfejs da się wystawić w sieci lokalnej. Testy pilnują
// rzeczy, których nie widać w kodzie renderera, a które łatwo skasować przy
// porządkach w arkuszu.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const H = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
const R = readFileSync(new URL('../ui/renderer.js', import.meta.url), 'utf8');
const S = readFileSync(new URL('../ui/strings.js', import.meta.url), 'utf8');
const PROG = /@media \(max-width: (\d+)px\) \{/;

/** Treść bloku `@media` dla wąskiego ekranu — do sprawdzania reguł w środku. */
function blokWaski() {
  const start = H.search(PROG);
  assert.ok(start > 0, 'brak punktu załamania dla wąskiego ekranu');
  // Blok domykamy licząc nawiasy, bo w środku są kolejne reguły.
  let i = H.indexOf('{', start);
  let glebokosc = 0;
  for (let k = i; k < H.length; k += 1) {
    if (H[k] === '{') glebokosc += 1;
    else if (H[k] === '}') {
      glebokosc -= 1;
      if (glebokosc === 0) return H.slice(i, k);
    }
  }
  throw new Error('nie znalazłam końca bloku @media');
}

describe('układ na wąskim ekranie', () => {
  test('jest meta viewport — bez niej telefon rysuje jak 980 px', () => {
    // Zobaczone 2026-09-08 z telefonu: całe okno pomniejszone do nieczytelności.
    assert.match(H, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  });

  test('viewport NIE jedzie bez punktów załamania', () => {
    // Sam viewport jest gorszy od jego braku: przeglądarka przestaje
    // pomniejszać, a szersze elementy zaczynają wystawać w bok.
    const maViewport = /<meta name="viewport"/.test(H);
    const maProg = PROG.test(H);
    assert.equal(maViewport, maProg, 'viewport i @media muszą istnieć razem');
  });

  test('próg nie schodzi poniżej 480 px', () => {
    // Przy 480 telefon w poziomie zostaje na układzie biurkowym, a tam ciasno.
    const [, prog] = H.match(PROG);
    assert.ok(Number(prog) >= 480, `próg ${prog}px jest za niski`);
  });

  test('siatki o sztywnej liczbie kolumn schodzą do jednej', () => {
    // `.cards`, `.st-grid` i `.row` zawijają się same (auto-fit / flex-wrap),
    // ale `.two` i `.three` mają kolumny wpisane na sztywno.
    assert.match(blokWaski(), /\.two, \.three \{ grid-template-columns:1fr; \}/);
  });

  test('pola mają pełny rozmiar podstawowy, żeby telefon nie przybliżał widoku', () => {
    // Przeglądarki na telefonach przybliżają stronę przy wejściu w pole
    // mniejsze niż 16 px i po wyjściu zostawiają ją przybliżoną. `1rem` to
    // przy domyślnych ustawieniach dokładnie 16 px — a gdy ktoś ustawił sobie
    // inną podstawę, jego wybór jest ważniejszy od tego progu.
    assert.match(blokWaski(), /input, select, textarea \{ font-size:1rem/);
  });

  test('zakładki w jednym rzędzie, ale przewijanie musi być WIDOCZNE', () => {
    // Sam przewijany pasek dawał wrażenie ucięcia („O programie też jest
    // ucięte", 2026-09-08). Rząd zostaje — przewijanie jest na telefonie
    // naturalne — ale krawędź musi się wygaszać, żeby było widać, że dalej
    // coś jest.
    const b = blokWaski();
    assert.match(b, /nav \{[^}]*flex-wrap:nowrap/);
    assert.match(b, /nav \{[^}]*overflow-x:auto/);
    assert.match(b, /nav \{[^}]*mask-image:linear-gradient\(to right/);
  });

  test('rząd przycisków w nagłówku może się złamać', () => {
    // `.hdr-actions` jest jednym pudełkiem flex. Bez zawijania w środku
    // dodatkowa ikona (kłódka przy interfejsie w sieci) wypychała „Zakończ"
    // za prawą krawędź ekranu — zgłoszone 2026-09-08 z telefonu.
    const b = blokWaski();
    assert.match(b, /\.hdr-actions \{[^}]*flex-wrap:wrap/);
    assert.match(b, /header #btnPause, header #btnQuit \{ min-width:0; \}/);
  });

  test('każda tabela siedzi w opakowaniu .tbl-scroll', () => {
    // Opakowanie steruje zachowaniem na obu szerokościach: na monitorze daje
    // przewijanie w poziomie (nagłówek nie ucieka razem z treścią), a na
    // telefonie zamienia wiersze w karty.
    const tabel = (H.match(/<table[ >]/g) || []).length;
    const opakowanych = (H.match(/<div class="tbl-scroll"><table[ >]/g) || []).length;
    assert.ok(tabel > 0, 'nie ma żadnej tabeli — test stracił sens');
    assert.equal(opakowanych, tabel, `${tabel} tabel, opakowanych ${opakowanych}`);
    assert.match(H, /\.tbl-scroll \{ overflow-x:auto; \}/);
  });

  test('na telefonie tabele Kolejki są KARTAMI, nie przewijaniem w bok', () => {
    // ZMIERZONE 2026-10-02 przy 390 px: przewijana tabela ucinała ostatnią
    // kolumnę, czyli POWÓD odrzucenia — jedyne, po co otwiera się tę zakładkę
    // na telefonie („sieć: ETIMEDOU…", „NOT_SAVED: bra…").
    const b = blokWaski();
    assert.match(b, /\.tbl-scroll \{ overflow-x:visible; \}/,
      'przewijanie w bok musi zniknąć, inaczej karty nic nie dają');
    assert.match(b, /\.tbl-scroll table, \.tbl-scroll tbody, \.tbl-scroll tr, \.tbl-scroll td \{ display:block/);
    assert.match(b, /\.tbl-scroll td::before \{ content:attr\(data-label\)/,
      'etykieta karty bierze się z data-label');
    // Treść musi móc się łamać — inaczej karta ucina tak samo jak tabela.
    assert.match(b, /overflow-wrap:anywhere/);
  });

  test('etykiety kart pochodzą z nagłówków tabeli, nie z drugiego słownika', () => {
    // Gdyby renderer miał własną listę etykiet, po zmianie nagłówka karty
    // pokazywałyby co innego niż tabela — i to tylko na telefonie.
    assert.match(R, /querySelectorAll\('thead th'\)/);
    assert.match(R, /data-label="/);
  });

  test('karty nie gubią semantyki tabeli dla czytnika ekranu', () => {
    // `display:block` odbiera tabeli jej rolę, więc role są w znacznikach —
    // inaczej na telefonie czytnik czytałby ciąg bloków bez związku.
    assert.equal((H.match(/<table role="table">/g) || []).length,
      (H.match(/<table[ >]/g) || []).length, 'każda tabela musi mieć role="table"');
    assert.match(H, /<tbody role="rowgroup"/);
    assert.match(H, /<th role="columnheader"/);
    assert.match(R, /<tr role="row">/);
    assert.match(R, /<td role="cell"/);
    // Nagłówek ma być UKRYTY WIZUALNIE, nie usunięty: display:none wyrzuciłby
    // go także z drzewa dostępności.
    const b = blokWaski();
    assert.match(b, /\.tbl-scroll thead \{ position:absolute/);
    assert.doesNotMatch(b, /\.tbl-scroll thead \{ display:none/);
  });

  test('nagłówek mieści się w dwóch wierszach na telefonie', () => {
    // Zmierzone 12.10.2026 przy 360 px: ikony (3 × 29 px), „Wstrzymaj" i
    // przełącznik widoku nie mieszczą się w jednym rzędzie — brakowało 6 px,
    // więc przełącznik spadał do TRZECIEGO wiersza. Trzy rzeczy trzymają
    // nagłówek w dwóch wierszach i każda z nich jest tu pilnowana:
    // ikony w osobnej grupie, ciaśniejsze przyciski i nazwa programu, która
    // poniżej 460 px ustępuje miejsca znakowi.
    const ikony = H.match(/<div class="hdr-icons">[\s\S]*?<\/div>/);
    assert.ok(ikony, 'ikony nagłówka muszą stać w osobnej grupie .hdr-icons');
    for (const id of ['langBtn', 'themeBtn', 'fsBtn']) {
      assert.match(ikony[0], new RegExp(`id="${id}"`), `${id} należy do .hdr-icons`);
    }
    const b = blokWaski();
    assert.match(b, /\.hdr-icons \{ margin-left:auto; \}/);
    assert.match(b, /header button\.act \{ padding:10px 12px; \}/);
    assert.match(H, /@media \(max-width: 460px\) \{\s*header #title \.pelna \{ display:none; \}/);
  });

  test('na telefonie nazwa jest krótsza, a PIN schodzi z nagłówka', () => {
    // Zamiast chować nazwę do zera, oddajemy jej miejsce zajęte przez
    // zamaskowany PIN (zmierzone 12.10.2026: PIN brał 63 px ze 127 px
    // plakietki, pełna nazwa 151 px, krótka 99 px, a na nazwę zostawało
    // 128 px po schowaniu PIN-u, a krótka nazwa „RD Bridge" bierze 73).
    assert.match(H, /<span\s+class="krotka" data-i18n="app\.nameShort">/);
    assert.match(S, /'app\.nameShort':/);
    const b = H.match(/@media \(max-width: 460px\) \{[\s\S]*?\n  \}/)[0];
    assert.match(b, /header #title \.krotka \{ display:inline; \}/);
    assert.match(b, /header #profile \.pin, header #profile \.stan \{ display:none; \}/);
    // „· brak łączności" rozpychał plakietkę tak, że ikony spadały niżej —
    // zobaczone na żywo 12.10.2026 po wyłączeniu serwisu.
    assert.match(R, /<span class="stan">/);
    // Przy bardzo długim znaku ustępuje nazwa programu, nie znak.
    assert.match(b, /header\.znak-dlugi #title \{ display:none; \}/);
    assert.match(b, /header #profile \{ flex:0 0 auto; \}/);
    assert.match(R, /classList\.toggle\('znak-dlugi', znak\.length >= 15\)/);
    // Znak wywoławczy ZOSTAJE — chowamy tylko PIN.
    assert.match(R, /<span class="pin">/);
    assert.doesNotMatch(b, /#profile \{ display:none/);
  });

  test('nazwa programu znika dopiero poniżej głównego progu', () => {
    // Próg nazwy jest WĘŻSZY od telefonowego: między 461 a 620 px nazwa,
    // znak i ikony mieszczą się razem, więc nie ma po co jej chować.
    const [, glowny] = H.match(PROG);
    const [, nazwy] = H.match(/@media \(max-width: (\d+)px\) \{\s*header #title/);
    assert.ok(Number(nazwy) < Number(glowny),
      `próg nazwy ${nazwy}px musi być niższy od telefonowego ${glowny}px`);
  });

  test('reguły wąskiego ekranu nie ruszają okna na monitorze', () => {
    // Okno startuje w 900×700, więc próg musi być wyraźnie niżej. Gdyby ktoś
    // podniósł go do szerokości okna, układ telefonu wszedłby na monitor.
    const [, prog] = H.match(PROG);
    const M = readFileSync(new URL('../ui/main.js', import.meta.url), 'utf8');
    const szerokoscOkna = Number(M.match(/OKNO_STARTOWE = \{ szer: (\d+)/)[1]);
    assert.ok(Number(prog) < szerokoscOkna,
      `próg ${prog}px nie może dochodzić do szerokości okna ${szerokoscOkna}px`);
  });
});

// ZGŁOSZONE 2026-10-12: „można zmniejszyć do jednego czy paru pikseli, nie jest
// to wygodne". Okno bez `setMinimumSize` zwija się do paska, po którym nie widać
// już, co to za program, a krawędź do rozciągnięcia trzeba trafić myszą.
describe('okno ma dolną granicę rozmiaru', () => {
  const M = readFileSync(new URL('../ui/main.js', import.meta.url), 'utf8');
  const minTresc = () => {
    const [, szer, wys] = M.match(/const MIN_TRESC = \{ szer: (\d+), wys: (\d+) \};/);
    return { szer: Number(szer), wys: Number(wys) };
  };

  test('minimum jest w ogóle ustawiane', () => {
    assert.match(M, /win\.setMinimumSize\(/);
  });

  test('minimalna szerokość zostawia nagłówek w dwóch wierszach', () => {
    // Zmierzone w oknie, z przyciskiem „Zakończ": przy 344 px strony nagłówek
    // ma dwa wiersze, przy 343 px trzy. Pionowy pasek przewijania zabiera
    // kolejne 15 px (okno 300 → strona 285), więc okno musi mieć co najmniej
    // 359 px. Pomiar na stronie z przeglądarki daje 300 px i jest nieprawdziwy:
    // tam nie ma „Zakończ", bo nie ma `window.bridge.quit`.
    assert.ok(minTresc().szer >= 359,
      `${minTresc().szer}px to za mało — „Zakończ" spadnie do trzeciego wiersza`);
  });

  test('minimum nie przekracza rozmiaru startowego okna', () => {
    // Rozmiar startowy czytamy ze STAŁEJ, nie z wywołania BrowserWindow —
    // tam stoi teraz wyrażenie z zapamiętanym rozmiarem.
    const [, szerokoscOkna, wysokoscOkna] = M.match(/OKNO_STARTOWE = \{ szer: (\d+), wys: (\d+)/);
    assert.ok(minTresc().szer < Number(szerokoscOkna));
    assert.ok(minTresc().wys < Number(wysokoscOkna));
  });

  test('minimum rośnie razem z powiększeniem okna', () => {
    // Przy 200% strona dostaje połowę pikseli okna, więc stałe minimum byłoby
    // minimum na niby. Stąd mnożenie i ponowne ustawienie po Ctrl +/-.
    assert.match(M, /MIN_TRESC\.szer \* z/);
    assert.match(M, /MIN_TRESC\.wys \* z/);
    const skrot = M.slice(M.indexOf('before-input-event'));
    assert.match(skrot.slice(0, skrot.indexOf('did-finish-load')),
      /ustawMinimalnyRozmiar\(nowy\);/,
      'po zmianie powiększenia klawiszem minimum musi być przeliczone');
  });

  test('minimum nie wychodzi poza obszar roboczy ekranu', () => {
    // Inaczej przy 300% na małym ekranie okna nie dałoby się już zmniejszyć
    // do rozmiaru, w którym w ogóle mieści się na pulpicie.
    assert.match(M, /screen\.getPrimaryDisplay\(\)\.workAreaSize/);
    assert.match(M, /Math\.min\(Math\.round\(MIN_TRESC\.szer \* z\).*praca\.width\)/);
  });
});
