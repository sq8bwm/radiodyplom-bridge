// Baza operatorów: znak + PIN do wyboru w celach fan-outu.
//
// Dlaczego to ma testy: PIN decyduje o tym, na czyje konto trafi QSO,
// a pomyłka nie objawia się błędem — serwer odpowiada success:true z pustym
// savedTo i łączność przepada. Każda ścieżka wyboru PIN-u musi być pewna.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeOperators, findOperator, resolveTargetPin } from '../src/operators.js';
import { expandTargets } from '../src/fanout.js';

const BOOK = [
  { call: 'SQ8BWM', name: 'Marek', pin: 'AAAA-1111' },
  { call: 'SP4OIK', pin: 'BBBB-2222' },
];

const PAYLOAD = {
  api_key: 'MAIN-0000', callsign: 'SP7VCL', station_callsign: 'SQ8BWM',
  band: '80m', mode: 'SSB', qso_date: '20260902', time_on: '190000',
};

describe('normalizeOperators', () => {
  test('znak idzie wielkimi literami i bez spacji', () => {
    assert.deepEqual(normalizeOperators([{ call: ' sq8bwm ', pin: ' X-1 ' }]),
      [{ call: 'SQ8BWM', pin: 'X-1' }]);
  });

  test('wpis bez znaku odpada', () => {
    assert.deepEqual(normalizeOperators([{ pin: 'X-1' }, { call: 'SP1AA' }]), [{ call: 'SP1AA' }]);
  });

  test('powtórzony znak zostaje raz', () => {
    const out = normalizeOperators([
      { call: 'SP1AA', pin: 'PIERWSZY' },
      { call: 'sp1aa', pin: 'DRUGI' },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].pin, 'PIERWSZY');
  });

  test('nie-lista daje pustą bazę, nie wyjątek', () => {
    assert.deepEqual(normalizeOperators(undefined), []);
    assert.deepEqual(normalizeOperators('SP1AA'), []);
  });

  test('puste pola nie zostają jako klucze', () => {
    assert.deepEqual(normalizeOperators([{ call: 'SP1AA', name: '  ', pin: '' }]),
      [{ call: 'SP1AA' }]);
  });
});

describe('findOperator', () => {
  test('szukanie nie zważa na wielkość liter', () => {
    assert.equal(findOperator(BOOK, 'sq8bwm')?.pin, 'AAAA-1111');
  });
  test('brak znaku i brak wpisu dają null', () => {
    assert.equal(findOperator(BOOK, ''), null);
    assert.equal(findOperator(BOOK, 'SP9ZZZ'), null);
  });
});

describe('resolveTargetPin', () => {
  test('pinFrom bierze PIN z bazy', () => {
    const r = resolveTargetPin({ station_callsign: 'SP0XYZ', pinFrom: 'SP4OIK' }, BOOK);
    assert.equal(r.pin, 'BBBB-2222');
    assert.equal(r.missing, null);
  });

  test('PIN wpisany wprost ma pierwszeństwo nad bazą', () => {
    // Zgodność ze starszymi konfiguracjami: kto wpisał PIN w celu, ten go dostaje.
    const r = resolveTargetPin({ pin: 'WPROST-9', pinFrom: 'SQ8BWM' }, BOOK);
    assert.equal(r.pin, 'WPROST-9');
  });

  test('brak jednego i drugiego = PIN główny', () => {
    assert.equal(resolveTargetPin({ station_callsign: 'SP0XYZ' }, BOOK).pin, null);
  });

  test('wskazanie na kogoś spoza bazy jest RAPORTOWANE, nie przemilczane', () => {
    // To jest cała pointa: cicha podmiana na PIN główny kończy się NOT_SAVED.
    const r = resolveTargetPin({ pinFrom: 'SP9ZZZ' }, BOOK);
    assert.equal(r.pin, null);
    assert.equal(r.missing, 'SP9ZZZ');
  });

  test('operator z bazy bez PIN-u też jest raportowany', () => {
    const r = resolveTargetPin({ pinFrom: 'SP1NOPIN' }, [{ call: 'SP1NOPIN' }]);
    assert.equal(r.pin, null);
    assert.equal(r.missing, 'SP1NOPIN');
  });

  test('wielkość liter w pinFrom nie ma znaczenia', () => {
    assert.equal(resolveTargetPin({ pinFrom: 'sq8bwm' }, BOOK).pin, 'AAAA-1111');
  });
});

describe('fan-out z bazą operatorów', () => {
  test('każda kopia dostaje PIN swojego operatora', () => {
    const targets = [
      { station_callsign: 'SQ8BWM', pinFrom: 'SQ8BWM' },
      { station_callsign: 'SP4OIK', pinFrom: 'SP4OIK' },
    ];
    const copies = expandTargets(PAYLOAD, targets, 'k', BOOK);
    assert.deepEqual(copies.map((c) => c.payload.api_key), ['AAAA-1111', 'BBBB-2222']);
  });

  test('cel bez wskazania zostaje na PIN-ie głównym', () => {
    const copies = expandTargets(PAYLOAD, [{ station_callsign: 'SP0XYZ' }], 'k', BOOK);
    assert.equal(copies[0].payload.api_key, 'MAIN-0000');
  });

  test('znak stacji i operator są niezależne od źródła PIN-u', () => {
    // Praca pod znakiem SES: stacja SP0XYZ, operator SQ8BWM, PIN profilu SQ8BWM.
    const copies = expandTargets(PAYLOAD,
      [{ station_callsign: 'SP0XYZ', operator: 'SQ8BWM', pinFrom: 'SQ8BWM' }], 'k', BOOK);
    assert.equal(copies[0].payload.station_callsign, 'SP0XYZ');
    assert.equal(copies[0].payload.operator, 'SQ8BWM');
    assert.equal(copies[0].payload.api_key, 'AAAA-1111');
  });

  test('brak bazy nie wywraca fan-outu', () => {
    const copies = expandTargets(PAYLOAD, [{ station_callsign: 'SP0XYZ', pinFrom: 'SQ8BWM' }], 'k');
    assert.equal(copies.length, 1);
    assert.equal(copies[0].payload.api_key, 'MAIN-0000');
  });

  test('klucze kopii nadal są różne', () => {
    // REGRESJA: wspólny klucz przepuszczał tylko pierwszą kopię.
    const copies = expandTargets(PAYLOAD, [
      { station_callsign: 'SQ8BWM', pinFrom: 'SQ8BWM' },
      { station_callsign: 'SP4OIK', pinFrom: 'SP4OIK' },
    ], 'k', BOOK);
    assert.equal(new Set(copies.map((c) => c.key)).size, 2);
  });
});
