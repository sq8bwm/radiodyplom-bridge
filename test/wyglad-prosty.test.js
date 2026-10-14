// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Wygląd widoku prostego: hierarchia, barwa stanu i kafelki.
//
// Nie chodzi o „ładnie" — każda z tych reguł odpowiada na zmierzony problem
// i każda ma sposób, żeby po cichu przestać działać przy porządkach
// w arkuszu. Liczby w komentarzach są z pomiaru na żywej stronie.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const H = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');

/** Treść reguły dla podanego selektora (pierwsze wystąpienie). */
function regula(selektor) {
  const i = H.indexOf(selektor);
  assert.ok(i > 0, `brak reguły ${selektor}`);
  const start = H.indexOf('{', i);
  return H.slice(start, H.indexOf('}', start));
}

describe('uniesienie zamiast samej kreski', () => {
  test('oba stopnie cienia są zdefiniowane w KAŻDYM motywie', () => {
    // Motyw ciemny ma dwa zapisy: po atrybucie i po ustawieniu systemu.
    // Pominięcie któregokolwiek znaczy panele bez cienia w połowie przypadków.
    assert.equal(H.split('--cien-1:').length - 1, 3, '--cien-1 musi być w trzech motywach');
    assert.equal(H.split('--cien-2:').length - 1, 3, '--cien-2 musi być w trzech motywach');
  });

  test('cień w ciemnym motywie jest GŁĘBSZY niż w jasnym', () => {
    // Na ciemnym tle delikatny cień jest niewidoczny — to nie kosmetyka,
    // tylko warunek, żeby panele w ogóle dało się odróżnić od tła.
    const jasny = H.match(/--cien-1: 0 1px 2px rgba\(16,21,28,\.(\d+)\)/)[1];
    const ciemny = H.match(/--cien-1: 0 1px 2px rgba\(0,0,0,\.(\d+)\)/)[1];
    assert.ok(Number(`0.${ciemny}`) > Number(`0.${jasny}`));
  });

  test('nagłówek, panele i karty unoszą się nad tłem', () => {
    assert.match(regula('header { display:flex'), /box-shadow:var\(--cien-1\)/);
    assert.match(regula('.panel { background'), /box-shadow:var\(--cien-2\)/);
    assert.match(regula('.card { background'), /box-shadow:var\(--cien-1\)/);
  });
});

describe('linijka stanu niesie barwę stanu', () => {
  // Barwa NICZEGO nie zastępuje — ten sam stan stoi obok tekstem — ale uczy
  // oko kształtu: skoro zwykle jest zielono, bursztyn widać przed czytaniem.
  for (const [sel, zmienna] of [
    ['#prostyStan { font-size', '--ok'],
    ['#prostyStan.ostrzega', '--warn'],
    ['#prostyStan.zle', '--err'],
  ]) {
    test(`${sel.split(' ')[0]} używa ${zmienna}`, () => {
      const r = regula(sel);
      assert.match(r, new RegExp(`color-mix\\(in srgb, var\\(${zmienna}\\)`));
      assert.match(r, new RegExp(`border-left(-color)?:(4px solid )?var\\(${zmienna}\\)`));
    });
  }

  test('trzy stany linijki zgadzają się z klasami z renderera', () => {
    // `prostyStan()` w rendererze zwraca dokładnie te klasy: '', 'ostrzega', 'zle'.
    const R = readFileSync(new URL('../ui/renderer.js', import.meta.url), 'utf8');
    for (const kl of ['ostrzega', 'zle']) {
      assert.ok(R.includes(`kl: '${kl}'`), `renderer nie nadaje klasy ${kl}`);
      assert.ok(H.includes(`#prostyStan.${kl}`), `arkusz nie zna klasy ${kl}`);
    }
  });
});

describe('kafelki z liczbami', () => {
  test('podpis stoi OBOK liczby i się nie łamie', () => {
    // Obok, nie pod: kafelek jest wtedy o 18 px niższy, a tyle wysokości
    // zostaje liście łączności (zmierzone: 71 px wobec 89 px).
    const r = regula('.liczba { background');
    assert.match(r, /align-items:baseline/);
    assert.match(regula('.liczba .etykieta'), /white-space:nowrap/);
  });

  test('podpis zawija się pod liczbę, zamiast wyjść poza kafelek', () => {
    // Przy 140% tekstu na stronie szerokiej na 345 px podpis wystawał poza
    // ramkę. `flex-wrap` robi to samo, co próg w @media, bez zgadywania progu.
    assert.match(regula('.liczba { background'), /flex-wrap:wrap/);
  });

  test('cyfry o stałej szerokości — licznik nie podskakuje', () => {
    assert.match(regula('.liczba .wartosc'), /font-variant-numeric:tabular-nums/);
  });

  test('na wąskim ekranie liczba jest mniejsza, ale nadal większa niż przed zmianą', () => {
    // 1.75rem = 28 px wobec 1.375rem = 22 px wcześniej. Mniejsza musi być,
    // żeby czterocyfrowy licznik zmieścił podpis obok siebie.
    const waski = H.slice(H.indexOf('@media (max-width: 620px) {\n    .liczby'));
    const [, rozmiar] = waski.match(/\.liczba \.wartosc \{ font-size:([\d.]+)rem/);
    assert.ok(Number(rozmiar) < 2.5 && Number(rozmiar) > 1.375,
      `na wąskim ekranie liczba ma ${rozmiar}rem`);
  });
});

describe('przyciski w nagłówku', () => {
  test('„Wstrzymaj" i przełącznik widoku mają RÓWNĄ szerokość', () => {
    // Kolumny 1fr wyrównują się do najszerszego napisu — bez magicznej
    // liczby, więc działa też po zmianie języka i po powiększeniu tekstu.
    assert.match(regula('.hdr-para {'), /grid-auto-columns:1fr/);
    assert.match(H, /<div class="hdr-para">[\s\S]*?id="btnPause"[\s\S]*?id="btnWidok"[\s\S]*?<\/div>/);
  });

  test('„Zakończ" stoi POZA parą i trzyma swoją szerokość', () => {
    // Jako jedyny robi coś nieodwracalnego — nie ma powodu, żeby ważył tyle
    // samo co przyciski używane w trakcie pracy.
    const para = H.slice(H.indexOf('<div class="hdr-para">'), H.indexOf('id="btnQuit"'));
    assert.ok(!para.includes('id="btnQuit"'));
    assert.match(H, /<\/div>\s*<span class="hdr-sep"><\/span>\s*<button[^>]*id="btnQuit"/);
  });

  test('na wąskim ekranie przyciski wypełniają wiersz', () => {
    // Nie na równe części: przy 360 px na trzy równe zostaje po 107 px,
    // a „Zaawansowane" potrzebuje 124 i napis byłby ucięty (zmierzone).
    const waski = H.slice(H.indexOf('.hdr-actions { flex:1 1 100%'));
    assert.match(waski.slice(0, 700), /\.hdr-para \{ display:flex; flex:1 1 auto; \}/);
    assert.match(waski.slice(0, 700), /\.hdr-para > button\.act \{ flex:1 1 auto; \}/);
    assert.match(waski.slice(0, 700), /\.hdr-sep \{ display:none; \}/);
  });
});
