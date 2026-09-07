// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Zachowania okna konfiguracji, których nie widzi żaden test jednostkowy:
// niezapisane zmiany, walidacja portu i sposób pokazania nasłuchu w sieci.
//
// Testy tekstowe, bo w tym projekcie nie ma DOM-u w testach. Sprawdzają rzeczy,
// które już raz zawiodły albo zostały zgłoszone jako usterka — nie „czy kod
// wygląda ładnie".
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const R = readFileSync('ui/renderer.js', 'utf8');
const H = readFileSync('ui/index.html', 'utf8');
const S = readFileSync('ui/strings.js', 'utf8');

describe('niezapisane zmiany w konfiguracji', () => {
  // ZGŁOSZONE 2026-09-07: „gdy przejdę do innej karty bez zapisu, tracę to,
  // co wpisałem". Wyjście przeładowywało formularz ze stanu na dysku.
  test('wyjście z zakładki pyta, gdy formularz jest brudny', () => {
    assert.match(R, /async function wolnoWyjscZKonfiguracji\(\)/);
    assert.match(R, /if \(!await wolnoWyjscZKonfiguracji\(\)\) return;/,
      'strażnik musi być wywołany w obsłudze zakładek');
  });

  test('pytanie ma TRZY odpowiedzi, bo to trzy różne decyzje', () => {
    // „nie zapisuj" i „zostań tutaj" to nie to samo — dwa przyciski zmuszałyby
    // do zgadywania, co robi „Nie".
    for (const k of ['btn.saveAndLeave', 'btn.discardChanges', 'btn.stayHere']) {
      assert.ok(S.includes(`'${k}'`), `brak tłumaczenia ${k}`);
    }
    assert.match(H, /id="askThird"/);
    assert.match(R, /trzecia:/);
  });

  test('nieudany zapis NIE wypuszcza z zakładki', () => {
    // Inaczej „Zapisz i wyjdź" przy błędnym polu gubiłoby zmiany dokładnie
    // tak, jak przed tą poprawką.
    const ciało = R.slice(R.indexOf('async function wolnoWyjscZKonfiguracji'));
    assert.match(ciało.slice(0, 900), /const zapisano = await saveFromForm\(\)/);
    assert.match(ciało.slice(0, 900), /return zapisano === true/);
  });

  test('formularz jest czysty po wczytaniu z dysku', () => {
    assert.match(R, /konfigCzysta\(\)/);
    const load = R.slice(R.indexOf('async function loadConfig'));
    assert.match(load.slice(0, 4000), /konfigCzysta\(\)/,
      'po wczytaniu formularz nie może być uznany za zmieniony');
  });
});

describe('port interfejsu', () => {
  // ZGŁOSZONE 2026-09-07: „musimy mieć możliwość zmiany portu, podobnie jak
  // z UDP".
  test('pole istnieje i jest zapisywane', () => {
    assert.match(H, /id="fApiPort"/);
    assert.match(R, /\$\('fApiPort'\)\.value = cfg\.api\?\.port/);
    const zapis = R.slice(R.indexOf('const r = await window.bridge.saveConfig('));
    assert.match(zapis.slice(0, 500), /\bport,/, 'port musi trafiać do zapisu');
  });

  test('zakres sprawdzany w kodzie, nie tylko atrybutem HTML', () => {
    // Atrybut `min` w przeglądarce da się obejść, a port poniżej 1024 wymaga
    // uprawnień roota — mostek nie ma ich i nie powinien mieć.
    assert.match(R, /port < 1024 \|\| port > 65535/);
    assert.match(S, /'hint\.apiPortRange'/);
  });
});

describe('nasłuch w sieci pokazany ikoną, nie plakietką', () => {
  // ZGŁOSZONE 2026-09-07: „nie podoba mi się wielkie czerwone ostrzeżenie".
  test('plakietki już nie ma, jest ikona z dymkiem', () => {
    assert.doesNotMatch(H, /id="netBadge"/, 'plakietka miała zniknąć');
    assert.match(H, /id="netIcon"/);
    assert.match(R, /b\.title = opis/, 'opis musi trafić do podpowiedzi');
  });

  test('kształt i kolor niosą stan', () => {
    assert.match(R, /SVG\.zamek\b/);
    assert.match(R, /SVG\.zamekOtwarty/);
    assert.match(R, /classList\.toggle\('zapis', !api\.tylkoOdczyt\)/);
    assert.match(H, /icon-btn\.net\.zapis/);
  });

  test('dymek ostrzega treścią, nie samym kolorem', () => {
    // Kolor sam nie wystarcza: nie każdy go odróżni, a zrzut ekranu w zgłoszeniu
    // bywa czarno-biały.
    const m = S.match(/'net\.tipWritable': '([^']+)'/);
    assert.ok(m, 'brak treści dymka po polsku');
    assert.match(m[1], /PIN/);
    assert.match(m[1], /UWAGA/);
  });
});

describe('tryb tylko do odczytu nie może blokować okna na pulpicie', () => {
  // ZGŁOSZONE 2026-09-07: „teraz przycisk Zapisz przestał reagować".
  // Wpisałam btnSave na listę przycisków wyłączanych w trybie tylko do
  // odczytu — a ten tryb chroni dostęp PO HTTP. Rdzeń blokuje zapis wyłącznie
  // w obsłudze żądań HTTP; okno na pulpicie idzie przez IPC i wolno mu
  // wszystko, bo kto siedzi przy maszynie, ma pełną władzę tak czy inaczej.
  test('blokada przycisków tylko dla okna po HTTP', () => {
    assert.match(R, /window\.bridge\.tryb === 'http'/);
    assert.match(R, /const blokuj = przezHttp && !!api\.tylkoOdczyt/);
    assert.match(R, /el\.disabled = blokuj/);
  });

  test('podpowiedź jest ZDEJMOWANA po wyjściu z trybu', () => {
    // Zostawiona kłamałaby nad włączonym przyciskiem.
    assert.match(R, /el\.title = blokuj \? t\('net\.readOnlyHint'\) : ''/);
  });

  test('rdzeń blokuje zapis tylko na ścieżce HTTP', () => {
    // Gdyby blokada trafiła kiedyś do IPC, okno na pulpicie przestałoby
    // zapisywać konfigurację — a wtedy nie ma czym tego trybu wyłączyć.
    const main = readFileSync('ui/main.js', 'utf8');
    assert.doesNotMatch(main, /readOnly|tylkoOdczyt/,
      'IPC nie może znać trybu tylko do odczytu');
  });
});

describe('adres interfejsu w panelu Stan', () => {
  test('panel pokazuje pełne adresy z portem', () => {
    assert.match(H, /id="ifaceInfo"/);
    assert.match(R, /\(a\.adresy \|\| \[\]\)/);
  });
});
