// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Zegar zasobnika rusza ikonę tylko wtedy, gdy jest co zmienić.
//
// `refreshTray` chodzi co 3 sekundy. Dopóki ustawiał ikonę i dymek
// bezwarunkowo, program co trzy sekundy ruszał oknem osadzonym w cudzym
// procesie: na XFCE ikona siedzi w panelu przez XEmbed (okno programu ma
// `_XEMBED_INFO`, a na liście `RegisteredStatusNotifierItems` nas nie ma),
// więc każde `setImage` to robota dla wtyczki zasobnika. Wtyczka systray
// w xfce4-panel 4.18.4 wywraca się przy pracy z tą ikoną (Ubuntu 24.04,
// 15.10.2026 — trzy awarie przy trzech startach programu), a my nie mamy
// powodu dokładać jej żądań, których nikt nie potrzebuje.
//
// Menu było tak chronione od dawna (`lastTrayKey`) — z innego powodu: na
// Windowsie przebudowa co 3 sekundy potrafiła sprawić, że menu przestawało
// się pokazywać. Tu pilnujemy, żeby cała trójka miała ten sam zamek.
//
// Czytamy plik jako tekst, bo uruchomienie `ui/main.js` wymagałoby Electrona.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MAIN = readFileSync('ui/main.js', 'utf8');

/** Ciało `function refreshTray() { … }` — po nawiasach klamrowych. */
function cialoRefreshTray() {
  const od = MAIN.indexOf('function refreshTray()');
  assert.ok(od > 0, 'nie znalazłam funkcji refreshTray');
  const start = MAIN.indexOf('{', od);
  let glebokosc = 0;
  for (let i = start; i < MAIN.length; i++) {
    if (MAIN[i] === '{') glebokosc++;
    else if (MAIN[i] === '}' && --glebokosc === 0) return MAIN.slice(start + 1, i);
  }
  assert.fail('nie znalazłam końca funkcji refreshTray');
}

/**
 * Głębokość zagnieżdżenia w klamrach, w miejscu `szukane`, licząc od ciała
 * funkcji. 0 = wywołanie bezwarunkowe, przy każdym tyknięciu zegara.
 * Nazw zmiennych celowo nie sprawdzamy — liczy się to, że wywołanie stoi
 * pod warunkiem, a nie jak ten warunek nazwaliśmy.
 */
function glebokoscWywolania(cialo, szukane) {
  const poz = cialo.indexOf(szukane);
  assert.ok(poz > 0, `nie znalazłam wywołania ${szukane}`);
  let g = 0;
  for (let i = 0; i < poz; i++) {
    if (cialo[i] === '{') g++;
    else if (cialo[i] === '}') g--;
  }
  return g;
}

describe('zasobnik: co trzy sekundy, ale bez zbędnego ruchu', () => {
  const cialo = cialoRefreshTray();

  for (const [co, wywolanie] of [
    ['ikona', 'tray.setImage('],
    ['dymek', 'tray.setToolTip('],
    ['menu', 'tray.setContextMenu('],
  ]) {
    test(`${co} zmienia się tylko wtedy, gdy jest co zmienić`, () => {
      assert.equal(cialo.split(wywolanie).length - 1, 1,
        `${wywolanie} ma w refreshTray wystąpić dokładnie raz`);
      assert.ok(glebokoscWywolania(cialo, wywolanie) > 0,
        `${wywolanie} stoi bezwarunkowo — przy wyłączonym zegarze nic się nie `
        + 'stanie, ale co 3 sekundy obciąża to wtyczkę zasobnika bez potrzeby');
    });
  }

  test('zegar odświeżania nadal chodzi', () => {
    // Zamek ma ograniczać pracę, nie zastępować odświeżania: stan zasobnika
    // musi gonić stan programu także wtedy, gdy nikt nie kliknął w okno.
    assert.match(MAIN, /setInterval\(refreshTray, \d+\)/);
  });

  test('pamięć ikony startuje od stanu, z jakim ikona powstaje', () => {
    // `new Tray(iconFor('ok'))` już ustawił obrazek. Gdyby pamięć startowała
    // od czegoś innego, pierwsze odświeżenie ustawiłoby ten sam plik drugi raz
    // — dokładnie przy starcie, czyli w chwili, w której wtyczka padała.
    const m = MAIN.match(/new Tray\(iconFor\('([a-z]+)'\)\)/);
    assert.ok(m, 'nie znalazłam tworzenia ikony zasobnika');
    const p = MAIN.match(/let lastTrayIcon = '([a-z]+)'/);
    assert.ok(p, 'brak pamięci ostatniego stanu ikony');
    assert.equal(p[1], m[1],
      'pamięć ikony startuje od innego stanu niż ten, z jakim ikona powstała');
  });
});
