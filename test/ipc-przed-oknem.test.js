// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Kolejność startu: mosty IPC rejestrujemy PRZED otwarciem okna.
//
// Renderer pyta o konfigurację i stan zaraz po wczytaniu strony. Gdy wyścig
// wygra okno, `invoke` rzuca „No handler registered for 'config:get'", wyjątek
// przerywa budowanie widoku i w oknie zostaje pusty szkielet — zakładki i ramki
// bez jednego napisu, bez komunikatu. Objaw jest rzadki (zwykle main zdąży
// pierwszy), więc regresja przeszłaby niezauważona: stąd ten test.
//
// Czytamy plik jako tekst, bo uruchomienie `ui/main.js` wymagałoby Electrona.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MAIN = readFileSync('ui/main.js', 'utf8');

/** Blok `app.whenReady().then(…)` — tam ustala się kolejność startu. */
function blokStartu() {
  // Z `.then(`, bo samo „app.whenReady()" pada też w komentarzu wyżej.
  const od = MAIN.indexOf('app.whenReady().then(');
  assert.ok(od > 0, 'nie znalazłam bloku app.whenReady().then(…)');
  const do_ = MAIN.indexOf("app.on('window-all-closed'", od);
  assert.ok(do_ > od, 'nie znalazłam końca bloku startowego');
  return MAIN.slice(od, do_);
}

describe('kolejność startu okna i mostów IPC', () => {
  test('okno otwiera się po rejestracji wszystkich handlerów', () => {
    const blok = blokStartu();
    const okno = blok.indexOf('showWindow();');
    assert.ok(okno > 0, 'w bloku startowym nie ma wywołania showWindow()');

    const handlery = [...blok.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)];
    assert.ok(handlery.length > 10, 'spodziewałam się kilkunastu mostów IPC');

    for (const h of handlery) {
      assert.ok(
        h.index < okno,
        `most '${h[1]}' rejestruje się PO otwarciu okna — renderer może zapytać, `
        + 'zanim handler powstanie, i zostanie pusty szkielet bez komunikatu',
      );
    }
  });

  test('istnieją mosty, o które renderer pyta najwcześniej', () => {
    const blok = blokStartu();
    for (const nazwa of ['config:get', 'status']) {
      assert.match(blok, new RegExp(`ipcMain\\.handle\\(\\s*'${nazwa}'`),
        `brak mostu '${nazwa}' — renderer woła go przy budowaniu widoku`);
    }
  });

  test('renderer naprawdę pyta o te mosty przy starcie', () => {
    // Gdyby renderer przestał wołać `getConfig()` przy starcie, powyższe testy
    // pilnowałyby kolejności, która nikomu już nie służy.
    const R = readFileSync('ui/renderer.js', 'utf8');
    assert.match(R, /window\.bridge\.getConfig\(\)/,
      'renderer nie pyta o konfigurację — sprawdź, czy ten test ma jeszcze sens');
  });
});
