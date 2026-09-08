// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Panel „Konto na radiodyplom.pl" — co znaczy brak danych.
//
// Serwis podaje listę stacji TYLKO w trakcie akcji. Poza akcją pusta lista
// jest normalna, a nasz dawny komunikat brzmiał jak awaria konta i niepokoił
// bez powodu (rozstrzygnięte 2026-09-08: po założeniu akcji próbnej komunikat
// zniknął).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const S = readFileSync(new URL('../ui/strings.js', import.meta.url), 'utf8');

describe('panel konta: brak stacji poza akcją to NIE awaria', () => {
  const R = readFileSync(new URL('../ui/renderer.js', import.meta.url), 'utf8');

  test('bez trwającej akcji komunikat jest neutralny', () => {
    // Potwierdzone 2026-09-08: serwis podaje listę stacji tylko w trakcie
    // akcji — po założeniu akcji próbnej komunikat „konto nie ma przypisanej
    // żadnej stacji" zniknął. Poza akcją brzmiał więc jak awaria konta.
    const blok = R.slice(R.indexOf('function renderAccount'));
    assert.match(blok, /const wAkcji = Array\.isArray\(acc\.activeActions\) && acc\.activeActions\.length > 0;/);
    assert.match(blok, /acc\.stations\.length === 0 && !wAkcji[\s\S]{0,200}account\.stationsDuringAction/);
  });

  test('w trakcie akcji brak stacji nadal jest ostrzeżeniem', () => {
    // Wtedy to prawdziwy problem: nie ma na co logować, a QSO wrócą odrzucone.
    const blok = R.slice(R.indexOf('function renderAccount'));
    assert.match(blok, /} else if \(acc\.stations\.length === 0\) \{[\s\S]{0,200}lvl-warn[\s\S]{0,120}account\.noStations/);
  });

  test('oba teksty są w obu językach', () => {
    for (const k of ['account.noStations', 'account.stationsDuringAction']) {
      const ile = [...S.matchAll(new RegExp(`'${k.replace('.', '\\.')}':`, 'g'))].length;
      assert.equal(ile, 2, `${k} ma ${ile} tłumaczeń, a ma mieć 2`);
    }
  });
});

describe('ostrzeżenie o znaku wskazuje właściwą przyczynę', () => {
  const S2 = readFileSync(new URL('../ui/strings.js', import.meta.url), 'utf8');
  const D = readFileSync(new URL('../src/daemon.js', import.meta.url), 'utf8');

  test('wymienia OBA warunki: akcja i konto', () => {
    // Ustalone 2026-09-08 na żywej akcji: konto z zaznaczonym „mogę logować
    // jako wszystkie stacje" nie mogło logować na SN8N, bo SN8N nie był dodany
    // do akcji. Serwis oddaje w obu przypadkach `savedTo: []`, więc nie da się
    // wskazać jednej przyczyny — trzeba wymienić dwie. Dawna rada („dopisz
    // stację w Managerze") kierowała tylko w jedno miejsce, i to nie zawsze to.
    const m = S2.match(/'chk\.missingStation': '([^']*(?:'\s*\+\s*'[^']*)*)'/);
    assert.ok(m, 'brak komunikatu o niedopuszczonym znaku');
    assert.match(m[1], /DWA/, 'komunikat musi mówić o dwóch warunkach');
    assert.match(m[1], /dodana do akcji/);
    assert.match(m[1], /konto/);
    assert.doesNotMatch(m[1], /Dopisz stację w Managerze/);
    // „aktywator" to złe słowo — w akcji dodaje się STACJE (poprawione przez
    // autora 2026-09-08: „a właściwie nie jako aktywator, a jako stacja").
    assert.doesNotMatch(m[1], /ktywator/);
  });

  test('to samo w logu daemona', () => {
    const blok = D.slice(D.indexOf("if (c.state === 'missing-station')"), D.indexOf("if (c.state === 'missing-station')") + 900);
    assert.match(blok, /dwa warunki/);
    assert.match(blok, /dodana do akcji/);
    assert.doesNotMatch(blok, /ktywator/);
  });

  test('podpowiedź przy rozgałęzianiu też mówi o obu warunkach', () => {
    const m = S2.match(/'hint\.fanout': '([^']*(?:'\s*\+\s*'[^']*)*)'/);
    assert.ok(m);
    assert.match(m[1], /DO AKCJI/);
    assert.match(m[1], /konta/);
    assert.doesNotMatch(m[1], /ktywator/);
  });

  test('oba języki mają tę samą treść co do sensu', () => {
    // Klucz musi być w obu blokach — inaczej angielska wersja zostanie ze starą,
    // myląco brzmiącą radą.
    for (const k of ['chk.missingStation', 'hint.fanout', 'confirm.targetsRejected']) {
      const ile = [...S2.matchAll(new RegExp(`'${k.replace('.', '\\.')}':`, 'g'))].length;
      assert.equal(ile, 2, `${k} ma ${ile} wystąpień, a ma mieć 2`);
    }
    const en = S2.slice(S2.indexOf("'chk.ok': 'The service"));
    assert.match(en, /TWO conditions must/);
    assert.match(en, /added to the action AND your account/);
    assert.doesNotMatch(en, /ctivator/, 'w akcji dodaje się STACJE, nie „aktywatorów"');
  });
});
