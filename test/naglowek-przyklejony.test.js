// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Nagłówek i zakładki przyklejone do góry okna.
//
// Testy CSS-u tekstem są brzydkie, ale ten błąd nie ma innego stróża: nie ma
// tu DOM-u ani przeglądarki w testach, a objaw widać dopiero po przewinięciu
// długiej zakładki. Zgłoszony 2026-09-07 zrzutem ekranu — paski statystyk
// wchodziły na nagłówek.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HTML = readFileSync('ui/index.html', 'utf8');

/** Wycina blok reguły CSS dla podanego selektora. */
function regula(selektor) {
  const i = HTML.indexOf(selektor + ' {');
  assert.ok(i >= 0, `nie znaleziono reguły dla ${selektor}`);
  return HTML.slice(i, HTML.indexOf('}', i) + 1);
}

describe('przyklejony nagłówek', () => {
  test('nagłówek i zakładki są w jednym przyklejonym pojemniku', () => {
    // Osobne `top` dla zakładek byłoby kruche: nagłówek zawija się przy
    // wąskim oknie, więc jego wysokość nie jest stała.
    const t = regula('.topbar');
    assert.match(t, /position:\s*sticky/);
    assert.match(t, /top:\s*0/);
    const topbar = HTML.indexOf('<div class="topbar">');
    assert.ok(topbar >= 0, 'brak pojemnika .topbar w HTML');
    assert.ok(topbar < HTML.indexOf('<header>'), '.topbar musi obejmować <header>');
    assert.ok(HTML.indexOf('</nav>') < HTML.indexOf('<main>'), 'zakładki muszą być przed <main>');
  });

  test('przyklejony pojemnik ma z-index', () => {
    // BEZ TEGO paski statystyk (position:relative, później w dokumencie)
    // malują się NAD nagłówkiem — oba mają wtedy z-index:auto.
    assert.match(regula('.topbar'), /z-index:\s*\d+/);
  });

  test('zakładki mają własne tło', () => {
    // Inaczej przewijana treść przejeżdża pod nimi i prześwituje.
    assert.match(regula('  nav'), /background:/);
  });

  test('nagłówek nie przykleja się już osobno', () => {
    // Dwa niezależne `position:sticky` rozjeżdżały się przy zawinięciu nagłówka.
    assert.doesNotMatch(regula('  header'), /position:\s*sticky/);
  });

  test('okienko pytania zostaje nad przyklejonym nagłówkiem', () => {
    const ask = Number(regula('  .ask').match(/z-index:\s*(\d+)/)?.[1]);
    const top = Number(regula('.topbar').match(/z-index:\s*(\d+)/)?.[1]);
    assert.ok(ask > top, `okienko (${ask}) musi być nad nagłówkiem (${top})`);
  });
});
