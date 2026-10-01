// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Czy każdy moduł rdzenia w ogóle da się zaimportować.
//
// Po co taki nudny test: przy usuwaniu modułu `operators.js` został po nim
// martwy `import` w `worker.js`. Cała reszta testów przeszła, bo ŻADEN z nich
// nie importował workera — a aplikacja nie wstałaby wcale. Ten test pilnuje,
// żeby taka dziura nie przeszła po cichu drugi raz.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Wszystkie moduły w src/, bez katalogu tools/ (to skrypty z efektami ubocznymi). */
function modules(dir, prefix = '') {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === 'tools') continue;
      out.push(...modules(join(dir, e.name), `${prefix}${e.name}/`));
    } else if (e.name.endsWith('.js')) {
      out.push(`${prefix}${e.name}`);
    }
  }
  return out;
}

describe('moduły rdzenia', () => {
  const found = modules(SRC);

  test('jest co sprawdzać', () => {
    assert.ok(found.length > 15, `znalazłam tylko ${found.length} modułów`);
  });

  for (const m of found) {
    // index.js sam uruchamia daemona, więc go pomijamy — reszta to biblioteki.
    if (m === 'index.js') continue;
    test(`${m} importuje się bez błędu`, async () => {
      await import(join(SRC, m));
    });
  }
});

describe('zestaw testów chodzi BEZ node_modules', () => {
  // ZŁAPANE 2026-10-01 przy budowaniu paczki w kontenerze Arch: pakowanie ze
  // źródeł nie ma `node_modules`, a `test/desktop-entry.test.js` importował
  // twardo `js-yaml`. Padał CAŁY plik, a z nim `check()` i cała budowa pakietu
  // — u nas nie było tego widać, bo u nas moduł jest.
  //
  // Zasada: w testach żadnego twardego importu spoza `node:` i ścieżek
  // względnych. Potrzebny moduł deweloperski wczytujemy miękko (`await import`
  // w try) i pomijamy te testy z podaną przyczyną.
  const TESTY = join(dirname(fileURLToPath(import.meta.url)));

  test('żaden plik testu nie importuje twardo modułu z node_modules', () => {
    const winni = [];
    for (const nazwa of readdirSync(TESTY).filter((f) => f.endsWith('.js'))) {
      const tresc = readFileSync(join(TESTY, nazwa), 'utf8');
      for (const m of tresc.matchAll(/^import[^;]*?from\s+'([^']+)'/gm)) {
        const skad = m[1];
        if (skad.startsWith('node:') || skad.startsWith('.') || skad.startsWith('/')) continue;
        winni.push(`${nazwa} → ${skad}`);
      }
    }
    assert.deepEqual(winni, [],
      `twardy import spoza node: w testach — bez node_modules padnie cały plik:\n${winni.join('\n')}`);
  });
});
