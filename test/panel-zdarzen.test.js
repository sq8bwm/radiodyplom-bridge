// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Panel „Ostatnie zdarzenia" — łączności w kolumnach.
//
// PO CO: do 09.10.2026 każdy wiersz był zdaniem („wysłane SP9XYZ → SN8N"),
// więc żeby znaleźć łączność, trzeba było je przeczytać — a pasma ani emisji
// nie było tam w ogóle. W kolumnach da się przebiec wzrokiem po znakach
// i sprawdzić pasmo, co w trakcie akcji jest całą wartością tego panelu.
//
// Te testy pilnują rzeczy, których nie widać w kodzie renderera, a które łatwo
// skasować przy porządkach w arkuszu — tak samo jak `interfejs-responsywny`.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const H = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
const R = readFileSync(new URL('../ui/renderer.js', import.meta.url), 'utf8');

/** Treść bloku `@media (max-width: N px)` — do sprawdzania reguł w środku. */
function blok(prog) {
  const start = H.indexOf(`@media (max-width: ${prog}px) {`);
  assert.ok(start > 0, `brak bloku dla ${prog} px`);
  let glebokosc = 0;
  const i = H.indexOf('{', start);
  for (let k = i; k < H.length; k += 1) {
    if (H[k] === '{') glebokosc += 1;
    else if (H[k] === '}') {
      glebokosc -= 1;
      if (glebokosc === 0) return H.slice(i, k);
    }
  }
  throw new Error('nie znalazłam końca bloku');
}

describe('panel zdarzeń: łączności w kolumnach', () => {
  test('wiersz łączności dostaje komplet kolumn', () => {
    for (const klasa of ['call', 'band', 'mode', 'stn', 'op']) {
      assert.match(R, new RegExp(`pole\\('${klasa}'`), `brak kolumny ${klasa}`);
    }
    assert.match(R, /class="src"/, 'brak plakietki źródła');
    assert.match(R, /class="qso /, 'wiersz łączności nie dostaje klasy qso');
  });

  test('KOMUNIKATY zostają pełną szerokością, nie w kolumnach', () => {
    // Przy odrzuceniu liczy się POWÓD, a nie wyrównanie — wciśnięty w kolumnę
    // zostałby ucięty, czyli zniknęłaby jedyna rzecz, po którą się tam patrzy.
    assert.match(R, /const wKolumnach = e\.kind === 'sent'/);
    assert.match(R, /if \(!wKolumnach\) \{[\s\S]*?class="what"/);
  });

  test('kolumny mają ODSTĘP, nie tylko szerokości', () => {
    // REGRESJA 09.10.2026: przy `gap:0` kolumny trzymały się wyłącznie dzięki
    // `width`, więc gdy któraś ją traciła, sąsiedzi się SKLEJALI („UA9CR40m”).
    // Celujemy w KONKRETNĄ regułę po `align-items:baseline`, nie w dowolne
    // „gap" w pliku: pierwsza wersja tego testu łapała `row-gap:1px` z reguły
    // zawijania i przepuszczała mutację `gap:0` — czyli dokładnie to, czego
    // miała pilnować.
    const regula = H.match(/ul\.events li\.qso \{\s*align-items:baseline;\s*gap:\s*([\d.]+)px/);
    assert.ok(regula, 'brak reguły z odstępem dla wiersza łączności');
    assert.ok(Number(regula[1]) > 0, `odstęp wynosi ${regula[1]}px — kolumny się skleją`);
  });

  test('szerokości to min-width — długi znak ROZSUWA wiersz, a nie zostaje ucięty', () => {
    // Ucięty znak to utrata informacji. Najdłuższy w 1840 prawdziwych QSO to
    // SP5DFK/QRP (10 znaków); 99,4% ma ≤ 6.
    for (const klasa of ['call', 'band', 'mode', 'stn', 'op']) {
      assert.match(H, new RegExp(`ul\\.events li\\.qso \\.${klasa}\\s*\\{[^}]*min-width`),
        `kolumna ${klasa} ma stałą szerokość — długi znak zostanie przycięty`);
    }
    assert.doesNotMatch(H, /ul\.events li\.qso \.call \{[^}]*[^-]width:/,
      'kolumna znaku ma sztywne width');
  });

  test('źródło jest dosunięte do prawej, więc plakietki stoją w jednym pionie', () => {
    // Bez tego plakietka wędruje za długością znaku stacji i przestaje być
    // kolumną — a to cały sens tego układu.
    assert.match(H, /ul\.events li\.qso \.src\s*\{[^}]*margin-left:\s*auto/);
  });
});

describe('panel zdarzeń: co oddajemy przy wąskim oknie', () => {
  test('NAJPIERW znika źródło — metadana ustępuje pierwsza', () => {
    assert.match(blok(620), /ul\.events li\.qso > \.src \{ display:none; \}/);
  });

  test('DOPIERO POTEM stacja i operator schodzą do drugiej linii', () => {
    // Odwrotna kolejność znaczyłaby, że tracimy treść łączności, trzymając
    // metadanę. Próg zawijania MUSI być węższy niż próg ukrycia źródła.
    const waski = blok(492);
    assert.match(waski, /flex-wrap:\s*wrap/);
    assert.match(waski, /> \.br \{ display:block/);
    assert.ok(492 < 620, 'progi w złej kolejności');
  });

  test('po zawinięciu źródło WRACA — jest miejsce, więc nie ma po co go chować', () => {
    assert.match(blok(492), /> \.src \{ display:inline-block/);
  });

  test('stacji i operatora NIE chowamy nigdy', () => {
    // To treść łączności, nie metadana. Przy trzech stacjach „na którą poszło”
    // jest istotne.
    for (const prog of [620, 492]) {
      assert.doesNotMatch(blok(prog), /> \.(stn|op) \{ display:none/,
        `przy ${prog} px chowamy stację albo operatora`);
    }
  });
});
