// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Interfejs serwowany po HTTP (przeglądarka zamiast okna Electrona).
//
// Testujemy pliki źródłowe strony, bo żaden test jednostkowy ani uruchomienie
// w Electronie tego nie dotyka — błędy wychodzą dopiero w przeglądarce,
// i to po cichu: zablokowane żądanie nie wywala strony, tylko zostawia ją pustą.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui');
const HTML = readFileSync(join(UI, 'index.html'), 'utf8');
const MOST = readFileSync(join(UI, 'bridge-http.js'), 'utf8');
const RENDERER = readFileSync(join(UI, 'renderer.js'), 'utf8');

describe('strona w przeglądarce', () => {
  test('CSP pozwala stronie wołać własne API', () => {
    // REGRESJA: `default-src 'none'` bez `connect-src` blokował każdy fetch.
    // Strona rysowała się, tabulatory działały, a treść była PUSTA — bez
    // żadnego błędu na wierzchu, bo blokada CSP nie przerywa wykonania.
    const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(HTML);
    assert.ok(m, 'CSP musi być zadeklarowane');
    assert.match(m[1], /connect-src 'self'/);
    assert.match(m[1], /default-src 'none'/, 'reszta zostaje zamknięta');
  });

  test('most ładuje się PRZED rendererem', () => {
    // Renderer sprawdza `window.bridge` już przy wczytaniu modułu.
    //
    // Szukamy ZNACZNIKÓW, nie nazw plików: pierwsza wersja tego testu trafiała
    // we wzmiankę o renderer.js w komentarzu nad skryptami i wywracała się na
    // poprawnym pliku. Ten sam błąd co przy `rm -rf` w linii `echo`.
    const znaczniki = [...HTML.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(znaczniki.includes('bridge-http.js'), 'most musi być na stronie');
    assert.ok(znaczniki.includes('renderer.js'), 'renderer musi być na stronie');
    assert.ok(znaczniki.indexOf('bridge-http.js') < znaczniki.indexOf('renderer.js'),
      'bridge-http.js przed renderer.js');
  });

  test('most nie nadpisuje mostu z Electrona', () => {
    // W Electronie `window.bridge` tworzy preload; ten plik ma wtedy milczeć.
    assert.match(MOST, /if \(!window\.bridge\)/);
  });

  test('most NIE udostępnia zamykania programu ani otwierania pliku', () => {
    // Zamknięcie usługi z karty przeglądarki przerwałoby przekazywanie QSO
    // w środku pracy w eterze; menedżera plików przeglądarka nie otworzy.
    assert.ok(!/\bquit\s*:/.test(MOST), 'brak quit');
    assert.ok(!/\bopenLog\s*:/.test(MOST), 'brak openLog');
    assert.match(MOST, /openUrl:/, 'ale odnośniki mają działać');
  });

  test('renderer chowa przyciski, których most nie daje', () => {
    assert.match(RENDERER, /if \(!window\.bridge\.quit\) \$\('btnQuit'\)\.hidden = true;/);
    assert.match(RENDERER, /if \(!window\.bridge\.openLog\) \$\('btnOpenLog'\)\.hidden = true;/);
  });

  test('most oddaje te same kształty co IPC', () => {
    // Uchwyty w main.js oddają LICZBĘ przywróconych i wyciszonych QSO oraz
    // samą tablicę wpisów logu. Oddanie tu obiektu dałoby „undefined" w oknie.
    assert.match(MOST, /requeue: async \(\) => \(await wyslij\('\/api\/requeue'\)\)\.restored/);
    assert.match(MOST, /ackProblems: async \(\) => \(await wyslij\('\/api\/problems\/ack'\)\)\.cleared/);
    assert.match(MOST, /\.entries \?\? \[\]/, 'log jako tablica');
  });

  test('obsługa kotwicy stoi na KOŃCU modułu', () => {
    // Postawiona wyżej wywracała się na martwym polu deklaracji `const`
    // używanych przez zakładkę Statystyki — zakładka rysowała się pusta.
    const kotwica = RENDERER.indexOf("location.hash || ''");
    const ostatniaStala = RENDERER.lastIndexOf('\nconst ');
    assert.ok(kotwica > 0, 'obsługa kotwicy musi istnieć');
    assert.ok(kotwica > ostatniaStala,
      'kotwica przed deklaracjami = ReferenceError w martwym polu');
  });
});
