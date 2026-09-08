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

  test('pola mają 16 px, żeby telefon nie przybliżał widoku', () => {
    // Przeglądarki na telefonach przybliżają stronę przy wejściu w pole
    // mniejsze niż 16 px i po wyjściu zostawiają ją przybliżoną.
    assert.match(blokWaski(), /input, select, textarea \{ font-size:16px/);
  });

  test('zakładki zostają w jednym rzędzie, przewijanym', () => {
    // Sześć zakładek zawiniętych do drugiego rzędu zabierało pół ekranu.
    const b = blokWaski();
    assert.match(b, /nav \{[^}]*flex-wrap:nowrap/);
    assert.match(b, /nav \{[^}]*overflow-x:auto/);
  });

  test('każda tabela siedzi w opakowaniu przewijanym w poziomie', () => {
    // Bez tego wąski ekran dawał poziomy pasek na CAŁYM oknie i nagłówek
    // uciekał w bok razem z treścią.
    const tabel = (H.match(/<table>/g) || []).length;
    const opakowanych = (H.match(/<div class="tbl-scroll"><table>/g) || []).length;
    assert.ok(tabel > 0, 'nie ma żadnej tabeli — test stracił sens');
    assert.equal(opakowanych, tabel, `${tabel} tabel, opakowanych ${opakowanych}`);
    assert.match(H, /\.tbl-scroll \{ overflow-x:auto; \}/);
  });

  test('reguły wąskiego ekranu nie ruszają okna na monitorze', () => {
    // Okno startuje w 900×700, więc próg musi być wyraźnie niżej. Gdyby ktoś
    // podniósł go do szerokości okna, układ telefonu wszedłby na monitor.
    const [, prog] = H.match(PROG);
    const M = readFileSync(new URL('../ui/main.js', import.meta.url), 'utf8');
    const szerokoscOkna = Number(M.match(/width: (\d+),/)[1]);
    assert.ok(Number(prog) < szerokoscOkna,
      `próg ${prog}px nie może dochodzić do szerokości okna ${szerokoscOkna}px`);
  });
});
