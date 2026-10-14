// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Pola z sekretem: hasło do interfejsu i PIN-y.
//
// Zasada: pole KRYJE wpisywane znaki, a oczko obok je pokazuje. Dotyczy
// wszystkich trzech miejsc, w których wpisuje się PIN, i działa tak samo
// w oknie i w przeglądarce — jedno zachowanie zamiast wyjątku, który trzeba
// tłumaczyć (decyzja Marka 2026-10-14: „mniej kombinowania i wyjątków").
//
// Testy tekstowe, bo w tym projekcie nie ma DOM-u w testach.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const H = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
const R = readFileSync(new URL('../ui/renderer.js', import.meta.url), 'utf8');
const S = readFileSync(new URL('../ui/strings.js', import.meta.url), 'utf8');

describe('pola z sekretem kryją wpisywane znaki', () => {
  // Do 0.1.42 PIN-y były zwykłym tekstem: widział je każdy, kto patrzył na
  // ekran albo oglądał zrzut z zawodów.
  for (const [id, gdzie] of [
    ['fApiPassword', 'hasło do interfejsu'],
    ['fPin', 'PIN w Konfiguracji'],
    ['prostyPinInput', 'PIN w belce widoku prostego'],
  ]) {
    test(`${gdzie} to pole typu password`, () => {
      const m = H.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
      assert.ok(m, `brak pola ${id}`);
      assert.match(m[0], /type="password"/, `${id} nie kryje wpisywanych znaków`);
    });
  }

  test('PIN celu fan-outu też, razem z oczkiem', () => {
    const wiersz = R.slice(R.indexOf('class="t-pin"') - 400, R.indexOf('class="t-pin"') + 400);
    assert.match(wiersz, /<input type="password" class="t-pin"/);
    assert.match(wiersz, /class="icon-btn t-oko"/);
  });

  test('pola PIN nie proszą menedżera haseł o zapamiętanie', () => {
    // Bez tego przeglądarka proponuje zapisanie PIN-u jako hasła do strony.
    for (const id of ['fPin', 'prostyPinInput']) {
      const m = H.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
      assert.match(m[0], /autocomplete="off"/, `${id} bez autocomplete="off"`);
    }
    assert.match(R, /<input type="password" class="t-pin" autocomplete="off"/);
  });
});

describe('oczko przy każdym polu z sekretem', () => {
  test('wszystkie cztery pola mają podpięte oczko', () => {
    for (const wywolanie of [
      /podepnijOko\(\$\('fApiPassword'\), \$\('fApiPasswordOko'\)/,
      /podepnijOko\(\$\('fPin'\), \$\('fPinOko'\)\)/,
      /podepnijOko\(\$\('prostyPinInput'\), \$\('prostyPinOko'\)\)/,
    ]) assert.match(R, wywolanie);
    // Cele fan-outu powstają na nowo przy każdym przerysowaniu listy.
    const po = R.slice(R.indexOf("$('targets').querySelectorAll('.t-station"));
    assert.match(po.slice(0, 400), /podepnijOko\(w\.querySelector\('\.t-pin'\), w\.querySelector\('\.t-oko'\)\)/);
  });

  test('wpisy po skasowanych polach wypadają z listy oczek', () => {
    // Inaczej każde przerysowanie celów zostawiałoby martwy wpis, a przy
    // zmianie języka przerysowywałoby przyciski, których już nie ma.
    assert.match(R, /if \(!OCZKA\[i\]\.pole\.isConnected\) OCZKA\.splice\(i, 1\);/);
  });

  test('oczko przy PIN-ie z pin.env jest wyłączone razem z polem', () => {
    // Pole jest wtedy puste i zablokowane — nie ma czego pokazywać.
    assert.match(R, /\$\('fPinOko'\)\.disabled = pinZEnv;/);
  });

  test('podpowiedzi oczka są tłumaczone przy zmianie języka', () => {
    assert.match(R, /drawOczka\(\);/);
    for (const klucz of ['btn.showPin', 'btn.hidePin']) {
      assert.ok(S.split(`'${klucz}'`).length - 1 >= 2,
        `${klucz} musi być w obu językach`);
    }
  });
});

describe('teksty nadążają za zachowaniem', () => {
  test('podpowiedź przy PIN-ie nie mówi już o widocznej masce', () => {
    // „Zostaw zamaskowany" przestało mieć sens, odkąd pole pokazuje kropki:
    // maski nie widać, dopóki nie klikniesz oczka.
    const pl = S.match(/'hint\.pin': '([^']+)'/)[1];
    assert.doesNotMatch(pl, /zamaskowan/i,
      'podpowiedź odsyła do maski, której nie widać');
  });
});
