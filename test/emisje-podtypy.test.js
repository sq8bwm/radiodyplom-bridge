// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Emisja a punktacja: `SUBMODE` ma pierwszeństwo, ale niczego nie zgadujemy.
//
// PO CO: w konfiguracji akcji organizator zaznacza DOZWOLONE EMISJE, a lista ma
// FT8, FT4, MFSK, PSK31, C4FM, DMR, DSTAR i inne jako OSOBNE pozycje. Jeśli
// zaznaczy FT4, a my wyślemy MFSK, łączność będzie w logu, ale NIE ZOSTANIE
// POLICZONA do dyplomu — i nikt nie powiąże tego z mostkiem.
//
// Serwer niczego nie poprawia: zmierzone 2026-10-06 na akcji testowej, gdzie
// FT4 zapisało się jako FT4, a MFSK jako MFSK.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { modeZRekordu } from '../src/modes.js';

describe('podtyp wygrywa, bo to on jest na liście organizatora', () => {
  for (const [mode, submode, oczekiwane] of [
    ['MFSK', 'FT4', 'FT4'],
    ['MFSK', 'JS8', 'JS8'],
    ['DIGITALVOICE', 'C4FM', 'C4FM'],
    ['DIGITALVOICE', 'DMR', 'DMR'],
    ['DIGITALVOICE', 'DSTAR', 'DSTAR'],
    ['PSK', 'PSK31', 'PSK31'],
  ]) {
    test(`${mode} + ${submode} → ${oczekiwane}`, () => {
      assert.equal(modeZRekordu({ mode, submode }), oczekiwane);
    });
  }

  test('USB zostaje SSB, bo to na liście jest SSB', () => {
    // Fonia idzie w drugą stronę: podtyp jest mniej użyteczny niż rodzina,
    // ale alias i tak sprowadza go z powrotem do SSB.
    assert.equal(modeZRekordu({ mode: 'SSB', submode: 'USB' }), 'SSB');
    assert.equal(modeZRekordu({ mode: 'SSB', submode: 'LSB' }), 'SSB');
  });
});

describe('bez podtypu NIE zgadujemy', () => {
  test('samo MFSK zostaje MFSK', () => {
    // Nie wiemy, czy to był FT4, JS8, czy coś innego z tej rodziny. Gdyby
    // organizator zaznaczył tylko FT4, taka łączność się nie policzy — ale
    // informacji o podtypie nie podał logger, a my jej nie wymyślamy.
    assert.equal(modeZRekordu({ mode: 'MFSK' }), 'MFSK');
    assert.equal(modeZRekordu({ mode: 'MFSK', submode: '' }), 'MFSK');
  });

  test('samo DIGITALVOICE zostaje DIGITALVOICE', () => {
    assert.equal(modeZRekordu({ mode: 'DIGITALVOICE' }), 'DIGITALVOICE');
  });

  test('emisje bez podtypów przechodzą bez zmian', () => {
    for (const m of ['FT8', 'CW', 'RTTY', 'AM', 'FM', 'MSK144', 'NXDN']) {
      assert.equal(modeZRekordu({ mode: m }), m);
    }
  });

  test('brak emisji nie zamienia się w nic sensownego', () => {
    assert.equal(modeZRekordu({}), '');
    assert.equal(modeZRekordu(null), '');
  });
});
