// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Powiększanie widoku: dla osób niedowidzących, ale przydaje się każdemu.
//
// Dwie niezależne drogi, świadomie:
//   - powiększenie OKNA (Ctrl +/-, tylko na pulpicie) — skaluje wszystko,
//   - skala CZCIONKI (ikona w nagłówku) — działa też w przeglądarce i mnoży
//     to, co użytkownik ustawił w systemie.
// Testy pilnują obu oraz tego, że rozmiary są względne — bez tego ustawienie
// systemowe było po prostu ignorowane.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const H = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
const R = readFileSync(new URL('../ui/renderer.js', import.meta.url), 'utf8');
const S = readFileSync(new URL('../ui/strings.js', import.meta.url), 'utf8');
const M = readFileSync(new URL('../ui/main.js', import.meta.url), 'utf8');
const C = readFileSync(new URL('../src/configedit.js', import.meta.url), 'utf8');
const PRZYKLAD = JSON.parse(
  readFileSync(new URL('../config.example.json', import.meta.url), 'utf8'),
);

describe('rozmiary są względne', () => {
  test('ani jeden font-size w px', () => {
    // Dopóki rozmiary były w px, „większa czcionka" z systemu i z przeglądarki
    // nie robiła NIC. To jest właściwa przyczyna, nie brak przełącznika.
    const css = H.slice(H.indexOf('<style>'), H.indexOf('</style>'));
    const px = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => m[0]);
    assert.deepEqual(px, [], `zostały rozmiary w px: ${px.join(', ')}`);
  });

  test('podstawa to 100%, czyli ustawienie użytkownika', () => {
    // `font-size:16px` na `html` wyglądałoby tak samo, ale ZASTĘPOWAŁOBY
    // ustawienie systemowe zamiast je uszanować.
    assert.match(H, /html \{ font-size:100%; \}/);
  });

  test('trzy stopnie skali, każdy z regułą w CSS', () => {
    for (const s of ['duzy', 'bardzo-duzy']) {
      assert.match(H, new RegExp(`html\\[data-fs="${s}"\\] \\{ font-size:1\\d\\d%; \\}`));
    }
  });

  test('ikony rosną razem z tekstem', () => {
    // Mały piktogram w wielkim przycisku wygląda na pomyłkę i nadal jest
    // nieczytelny — a to ten sam użytkownik, który powiększył tekst.
    assert.match(H, /button\.icon-btn svg \{ width:1\.15em; height:1\.15em/);
  });
});

describe('przełącznik skali w nagłówku', () => {
  test('przycisk jest w nagłówku', () => {
    const naglowek = H.slice(H.indexOf('<header>'), H.indexOf('</header>'));
    assert.match(naglowek, /id="fsBtn"/);
  });

  test('lista stopni w rdzeniu i w interfejsie jest ta sama', () => {
    // Rdzeń nie może importować z `ui/` (paczka bez interfejsu kopiuje tylko
    // `src/`), więc lista jest w dwóch miejscach i musi się zgadzać.
    const wRdzeniu = C.match(/const SKALE = \[([^\]]*)\]/)[1];
    const wOknie = R.match(/const SKALE = \[([^\]]*)\]/)[1];
    assert.equal(wRdzeniu.replace(/\s/g, ''), wOknie.replace(/\s/g, ''));
  });

  test('każdy stopień ma tłumaczenie w obu językach', () => {
    const stopnie = C.match(/const SKALE = \[([^\]]*)\]/)[1]
      .split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
    assert.equal(stopnie.length, 3);
    for (const s of stopnie) {
      const ile = [...S.matchAll(new RegExp(`'fs\\.${s}':`, 'g'))].length;
      assert.equal(ile, 2, `stopień ${s} ma ${ile} tłumaczeń, a ma mieć 2`);
    }
  });

  test('wybór przeżywa restart (zapis do pliku)', () => {
    // Bez pola w `writeConfigFile` wybór ginął przy pierwszym zapisie z okna:
    // rozwinięcie oryginału wygrywa. Ta pułapka zdarzyła się już przy motywie.
    assert.match(C, /fontScale: cfg\.fontScale \|\| 'normal',/);
    assert.match(C, /cfg\.fontScale = SKALE\.includes\(patch\.fontScale\)/);
  });

  test('szablon konfiguracji zna oba pola', () => {
    assert.equal(PRZYKLAD.fontScale, 'normal');
    assert.equal(PRZYKLAD.ui.zoom, 1);
  });
});

describe('powiększanie okna skrótem', () => {
  test('Ctrl + / - / 0 są łapane', () => {
    // Program nie ma paska menu (żyje w zasobniku), więc nie ma gdzie powiesić
    // akceleratorów — klawisze łapiemy przed przekazaniem ich stronie.
    assert.match(M, /before-input-event/);
    assert.match(M, /\['\+', '=', 'Add'\]\.includes\(klawisz\.key\)/);
    assert.match(M, /\['-', '_', 'Subtract'\]\.includes\(klawisz\.key\)/);
  });

  test('powiększenie jest zapamiętywane i przywracane', () => {
    // Kto potrzebuje większego widoku, potrzebuje go przy KAŻDYM starcie.
    assert.match(M, /saveConfig\?\.\(\{ ui: \{ zoom: z \} \}\)/);
    assert.match(M, /did-finish-load/);
    assert.match(M, /setZoomFactor/);
    assert.match(C, /cfg\.ui\.zoom = Math\.max\(0\.8, Math\.min\(3, z\)\)/);
  });

  test('zapamiętane powiększenie stosujemy ZAWSZE, także 1', () => {
    // Chromium pamięta powiększenie sam, per adres. Warunek „ustaw tylko gdy
    // różne od 1" oddawał mu pole: okno wstawało powiększone, choć plik mówił
    // `zoom: 1`. Zobaczone na zrzucie przy sprawdzaniu skali czcionki.
    const blok = M.slice(M.indexOf("did-finish-load"));
    assert.doesNotMatch(blok.slice(0, 400), /if \(z !== 1\)/,
      'warunek oddaje pierwszeństwo pamięci przeglądarki');
    assert.match(blok, /win\.webContents\.setZoomFactor\(Math\.max\(0\.8, Math\.min\(3, z\)\)\)/);
  });

  test('szczypanie dwoma palcami też działa', () => {
    assert.match(M, /setVisualZoomLevelLimits\(1, 3\)/);
  });
});
