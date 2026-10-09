// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Podział na zakładki: „czy jestem podłączony" osobno od „co się dzieje z QSO".
//
// PO CO: do 0.1.40 zakładka Stan mieszała dwie różne rzeczy — konfigurację
// i tożsamość (konto, nasłuch, interfejs), które zmieniają się raz na tydzień,
// z ruchem na żywo (liczniki, zdarzenia), na który patrzy się co minutę.
// Teraz ruch jest na QSOs, a Stan odpowiada wyłącznie na pytanie
// „czy jestem dobrze podłączony".
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const H = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
const R = readFileSync(new URL('../ui/renderer.js', import.meta.url), 'utf8');
const S = readFileSync(new URL('../ui/strings.js', import.meta.url), 'utf8');

/** Treść sekcji o podanym identyfikatorze. */
function sekcja(id) {
  const start = H.indexOf(`<section id="${id}"`);
  assert.ok(start > 0, `brak sekcji ${id}`);
  const koniec = H.indexOf('</section>', start);
  return H.slice(start, koniec);
}

describe('zakładka QSOs', () => {
  test('istnieje i jest domyślna — na nią patrzy się w trakcie pracy', () => {
    assert.match(H, /<button data-tab="qso" class="active"/);
    assert.match(H, /<section id="qso" class="active">/);
  });

  test('Stan NIE jest już domyślny', () => {
    assert.doesNotMatch(H, /<button data-tab="stan" class="active"/);
    assert.doesNotMatch(H, /<section id="stan" class="active"/);
  });

  test('ma liczniki ORAZ zdarzenia ORAZ obie tabele kolejki', () => {
    const q = sekcja('qso');
    assert.match(q, /<div class="cards">/, 'brak kafelków');
    assert.match(q, /id="lastInfo"/, 'brak panelu zdarzeń');
    assert.match(q, /data-i18n="panel\.pending"/, 'brak tabeli oczekujących');
    assert.match(q, /data-i18n="panel\.rejected"/, 'brak tabeli odrzuconych');
  });

  test('licznik stoi na tej samej zakładce co tabela, którą liczy', () => {
    // Rozdzielenie ich znaczyłoby, że widzisz „ODRZUCONE 2" w jednym miejscu,
    // a żeby sprawdzić KTÓRE, musisz przełączyć zakładkę.
    const q = sekcja('qso');
    assert.ok(q.indexOf('id="kFailed"') < q.indexOf('panel.rejected'),
      'kafelek odrzuconych powinien stać nad swoją tabelą');
  });
});

describe('zakładka Stan', () => {
  test('odpowiada tylko na „czy jestem dobrze podłączony"', () => {
    const st = sekcja('stan');
    for (const panel of ['panel.account', 'panel.listen', 'panel.willSend',
      'panel.iface', 'panel.sources']) {
      assert.match(st, new RegExp(`data-i18n="${panel}"`), `brak panelu ${panel}`);
    }
  });

  test('NIE ma już liczników ani zdarzeń — to ruch, nie konfiguracja', () => {
    const st = sekcja('stan');
    assert.doesNotMatch(st, /<div class="cards">/);
    assert.doesNotMatch(st, /id="lastInfo"/);
  });
});

describe('nazwa i stare odnośniki', () => {
  test('zakładka nazywa się QSOs w OBU językach — krótkie i jednoznaczne', () => {
    const wystapienia = S.match(/'tab\.qso': 'QSOs',/g) || [];
    assert.equal(wystapienia.length, 2, 'QSOs powinno być w obu wersjach językowych');
    assert.doesNotMatch(S, /'tab\.queue'/, 'został nieużywany klucz tab.queue');
  });

  test('adres …/#kolejka nadal otwiera właściwą zakładkę', () => {
    // Identyfikator zmienił się z „kolejka" na „qso", ale stary adres mógł
    // zostać w czyichś zakładkach przeglądarki albo w notatce.
    assert.match(R, /zadanaSurowa === 'kolejka' \? 'qso'/);
  });
});

describe('kafelki', () => {
  test('podpis pod liczbą ZOSTAJE — bez niego liczniki mylą się ze sobą', () => {
    // Powód historyczny: licznik trwały i licznik procesu wyglądały na to samo,
    // pokazując 1119 przy 191. Dymek nie pomaga, bo problem jest przy pierwszym
    // spojrzeniu, a na telefonie dymka nie ma wcale.
    assert.match(H, /\.card \.s \{[^}]*min-height/);
    assert.match(R, /renderCards/);
  });

  test('są niskie, bo stoją nad tabelami', () => {
    const m = H.match(/\.card \{[^}]*padding:\s*(\d+)px/);
    assert.ok(m, 'brak paddingu kafelka');
    assert.ok(Number(m[1]) <= 9, `padding ${m[1]}px — kafelki zjadają miejsce na łączności`);
  });
});
