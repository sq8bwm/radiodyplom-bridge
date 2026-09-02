// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Słownik interfejsu: kompletność i brak zdublowanych kluczy.
//
// Po co: przy dodawaniu zakładki „O programie" ten sam klucz trafił dwa razy
// do bloku polskiego, bo linia `'tab.log': 'Log',` jest w obu językach
// identyczna. W obiekcie JS wygrywa ostatni wpis, więc polski interfejs
// zaczął pokazywać angielską etykietę — bez żadnego błędu. Widać to było
// dopiero na zrzucie ekranu. Ten test wyłapuje to od razu.
//
// Duplikatów NIE da się zauważyć po sparsowaniu obiektu (nadpisanie jest
// bezgłośne), więc czytamy plik jako tekst.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { LANGS, setLang, t } from '../ui/strings.js';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'strings.js'),
  'utf8',
);

/** Klucze wypisane w bloku danego języka, w kolejności z pliku. */
function keysOf(lang) {
  const m = new RegExp(`\\n  ${lang}: \\{(.*?)\\n  \\},`, 's').exec(SRC);
  assert.ok(m, `nie znalazłam bloku języka ${lang}`);
  return [...m[1].matchAll(/^\s*'([^']+)':/gm)].map((x) => x[1]);
}

describe('słownik interfejsu', () => {
  test('są oba języki i mają wpisy', () => {
    assert.deepEqual(LANGS, ['pl', 'en']);
    for (const l of LANGS) assert.ok(keysOf(l).length > 50, `${l}: za mało kluczy`);
  });

  for (const lang of ['pl', 'en']) {
    test(`${lang}: żaden klucz nie jest zdublowany`, () => {
      const keys = keysOf(lang);
      const dup = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
      assert.deepEqual(dup, [], `zdublowane klucze: ${dup.join(', ')}`);
    });
  }

  test('oba języki mają dokładnie ten sam zestaw kluczy', () => {
    const pl = new Set(keysOf('pl'));
    const en = new Set(keysOf('en'));
    assert.deepEqual([...pl].filter((k) => !en.has(k)), [], 'brakuje w en');
    assert.deepEqual([...en].filter((k) => !pl.has(k)), [], 'brakuje w pl');
  });

  test('żaden przekład nie jest pustym napisem', () => {
    for (const l of LANGS) {
      setLang(l);
      for (const k of keysOf(l)) {
        assert.ok(String(t(k)).trim().length > 0, `${l}: puste tłumaczenie ${k}`);
      }
    }
  });

  test('tłumaczenia się nie zapętlają na kluczu', () => {
    // t() zwraca klucz, gdy go nie znajdzie — łatwo tak przeoczyć literówkę.
    for (const l of LANGS) {
      setLang(l);
      for (const k of keysOf(l)) assert.notEqual(t(k), k, `${l}: ${k} zwraca własną nazwę`);
    }
  });

  test('polski i angielski nie są tym samym napisem tam, gdzie nie powinny', () => {
    // Kilka etykiet jest identycznych z natury (Log, Port, API…), więc
    // sprawdzamy tylko, czy przekłady NIE są w całości skopiowane.
    const same = keysOf('pl').filter((k) => {
      setLang('pl'); const p = t(k);
      setLang('en'); return p === t(k);
    });
    assert.ok(same.length < keysOf('pl').length / 2,
      `zbyt wiele identycznych przekładów (${same.length}) – blok mógł zostać skopiowany`);
  });
});
