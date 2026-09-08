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
