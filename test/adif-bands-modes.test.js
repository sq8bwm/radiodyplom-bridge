// Parser ADIF, granice pasm, normalizacja emisji.
// Testy przypinają błędy, które faktycznie wystąpiły w rozwoju.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseAdif } from '../src/adif.js';
import { bandFromMHz, bandFromHz } from '../src/bands.js';
import { normalizeMode } from '../src/modes.js';

describe('parseAdif', () => {
  test('czyta pola wg deklarowanej długości i kończy na <eor>', () => {
    const r = parseAdif('<call:6>SP9XYZ<band:3>40m<mode:3>SSB<eor><call:4>IGNO');
    assert.deepEqual(r, { call: 'SP9XYZ', band: '40m', mode: 'SSB' });
  });

  test('nazwy pól są sprowadzane do małych liter', () => {
    assert.equal(parseAdif('<CALL:4>SP9X<EOR>').call, 'SP9X');
  });

  test('typ pola (:D, :T, :N) nie psuje odczytu', () => {
    const r = parseAdif('<qso_date:8:D>20260831<time_on:6:T>101500<freq:7:N>7.14000<eor>');
    assert.equal(r.qso_date, '20260831');
    assert.equal(r.time_on, '101500');
    assert.equal(r.freq, '7.14000');
  });

  test('znaki < i > w treści nie rozjeżdżają parsera (długość rządzi)', () => {
    // To jest sedno formatu ADIF: wartość czytamy po długości, nie do nawiasu.
    const r = parseAdif('<comment:4><a>b<call:4>SP9X<eor>');
    assert.equal(r.comment, '<a>b');
    assert.equal(r.call, 'SP9X');
  });

  test('puste wejście nie wybucha', () => {
    assert.deepEqual(parseAdif(''), {});
    assert.deepEqual(parseAdif(null), {});
  });
});

describe('bandFromMHz', () => {
  test('granice pasm są domknięte', () => {
    assert.equal(bandFromMHz(1.8), '160m');
    assert.equal(bandFromMHz(2.0), '160m');
    assert.equal(bandFromMHz(7.0), '40m');
    assert.equal(bandFromMHz(7.3), '40m');
  });

  test('poza pasmem zwraca null, nie zgaduje', () => {
    assert.equal(bandFromMHz(1.799), null);
    assert.equal(bandFromMHz(7.301), null);
    assert.equal(bandFromMHz(999), null);
    assert.equal(bandFromMHz(0), null);
    assert.equal(bandFromMHz(NaN), null);
  });

  test('VHF/UHF', () => {
    assert.equal(bandFromMHz(145.5), '2m');
    assert.equal(bandFromMHz(144.3), '2m');
    assert.equal(bandFromMHz(433.5), '70cm');
  });

  test('bandFromHz przelicza jednostki', () => {
    assert.equal(bandFromHz(14074000), '20m');
    assert.equal(bandFromHz(10120000), '30m');
  });
});

describe('normalizeMode', () => {
  test('USB i LSB to jednoznaczne podmody SSB', () => {
    assert.equal(normalizeMode('USB'), 'SSB');
    assert.equal(normalizeMode('LSB'), 'SSB');
    assert.equal(normalizeMode('usb'), 'SSB');
  });

  // REGRESJA: PHONE było mapowane na SSB, co na 2 m i 70 cm bywa błędem,
  // bo fonia tam to często FM. Emisja wpływa na punktację akcji.
  test('PHONE NIE jest zgadywane jako SSB', () => {
    assert.equal(normalizeMode('PHONE'), 'PHONE');
  });

  // REGRESJA: DIGITAL/DIGI były mapowane na "DATA", a taka emisja
  // nie istnieje w enumeracji ADIF.
  test('DIGITAL/DIGI nie są mapowane na nieistniejące DATA', () => {
    assert.equal(normalizeMode('DIGITAL'), 'DIGITAL');
    assert.equal(normalizeMode('DIGI'), 'DIGI');
  });

  test('znane emisje przechodzą bez zmian, tylko wielkimi literami', () => {
    for (const m of ['SSB', 'FM', 'AM', 'CW', 'RTTY', 'FT8', 'C4FM']) {
      assert.equal(normalizeMode(m.toLowerCase()), m);
    }
  });

  test('brak wartości daje pusty łańcuch', () => {
    assert.equal(normalizeMode(''), '');
    assert.equal(normalizeMode(null), '');
    assert.equal(normalizeMode(undefined), '');
  });
});
