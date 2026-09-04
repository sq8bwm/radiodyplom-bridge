// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Sprawdzanie konfiguracji wobec uprawnień konta.
//
// Model uprawnień ustalony pomiarem (2026-09-02) i potwierdzony przez autora
// serwisu (2026-09-04): PIN należy do konta, konto ma listę znaków stacji.
// Testy pilnują dwóch rzeczy, na których łatwo się przejechać:
//   1. cel z WŁASNYM PIN-em sprawdza się wobec SWOJEGO konta, nie głównego,
//   2. „nie wiem" nigdy nie udaje ani zgody, ani odmowy.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { distinctPins, verifyTargets, blockingTargets, isBlocking } from '../src/accounts.js';

/** Udana odpowiedź PING-a. */
function konto(operator, stations, activeActions = [{ id: 295 }]) {
  return { ok: true, operator, stations, activeActions, pinExpires: null, apiEnabled: true };
}

describe('distinctPins', () => {
  test('sam PIN główny, gdy cele go nie nadpisują', () => {
    const p = distinctPins({ radiodyplom: { pin: 'G' }, forward: { targets: [{ station_callsign: 'SN8N' }] } });
    assert.equal(p.length, 1);
    assert.deepEqual(p[0], { pin: 'G', main: true, stations: ['SN8N'] });
  });

  test('PIN celu daje osobny wpis', () => {
    const p = distinctPins({
      radiodyplom: { pin: 'G' },
      forward: { targets: [{ station_callsign: 'SN8N' }, { station_callsign: 'SQ8BWA', pin: 'A' }] },
    });
    assert.deepEqual(p.map((x) => x.pin), ['G', 'A']);
    assert.deepEqual(p[1].stations, ['SQ8BWA']);
  });

  test('ten sam PIN w dwóch celach to JEDEN wpis', () => {
    // Sedno: inaczej odpytywalibyśmy to samo konto kilka razy i zjadali
    // komuś limit tempa bez żadnego zysku.
    const p = distinctPins({
      radiodyplom: { pin: 'G' },
      forward: { targets: [{ station_callsign: 'SP1A', pin: 'A' }, { station_callsign: 'SP2B', pin: 'A' }] },
    });
    assert.equal(p.length, 2);
    assert.deepEqual(p[1].stations, ['SP1A', 'SP2B']);
  });

  test('PIN celu równy głównemu nie dubluje wpisu', () => {
    const p = distinctPins({
      radiodyplom: { pin: 'G' },
      forward: { targets: [{ station_callsign: 'SN8N', pin: 'G' }] },
    });
    assert.equal(p.length, 1);
    assert.equal(p[0].main, true);
  });

  test('brak PIN-u głównego nie wywala i nie wymyśla wpisu', () => {
    const p = distinctPins({ radiodyplom: {}, forward: { targets: [{ station_callsign: 'SN8N' }] } });
    assert.deepEqual(p, []);
  });

  test('pusta i połamana konfiguracja', () => {
    assert.deepEqual(distinctPins({}), []);
    assert.deepEqual(distinctPins(null), []);
    assert.deepEqual(distinctPins({ radiodyplom: { pin: 'G' } }), [{ pin: 'G', main: true, stations: [] }]);
  });
});

describe('verifyTargets', () => {
  const accounts = new Map([
    ['G', konto('SQ8BWM', ['SN0LPU', 'SN8N', 'SQ8BWA', 'SQ8BWM'])],
    ['A', konto('SQ8BWA', ['SQ8BWA'])],
  ]);

  test('stacja na liście konta → ok', () => {
    const [c] = verifyTargets({ targets: [{ station_callsign: 'SN8N' }], mainPin: 'G', accounts });
    assert.equal(c.state, 'ok');
    assert.equal(c.blocking, false);
    assert.equal(c.pinSource, 'main');
    assert.equal(c.operator, 'SQ8BWM');
  });

  test('stacja poza listą → missing-station i blokuje', () => {
    const [c] = verifyTargets({ targets: [{ station_callsign: 'SP9XYZ' }], mainPin: 'G', accounts });
    assert.equal(c.state, 'missing-station');
    assert.equal(c.blocking, true);
  });

  test('cel z własnym PIN-em sprawdza się wobec SWOJEGO konta', () => {
    // Sedno całej funkcji. SN8N jest na liście konta głównego, ale kopia leci
    // kluczem konta A, które ma tylko SQ8BWA — więc to się NIE zapisze.
    // Sprawdzanie wobec konta głównego dałoby tu fałszywe „w porządku".
    const [c] = verifyTargets({
      targets: [{ station_callsign: 'SN8N', pin: 'A' }], mainPin: 'G', accounts,
    });
    assert.equal(c.state, 'missing-station');
    assert.equal(c.pinSource, 'own');
    assert.equal(c.operator, 'SQ8BWA', 'komunikat ma nazwać konto, którego brak dotyczy');
  });

  test('i odwrotnie: stacja z listy konta celu przechodzi', () => {
    const [c] = verifyTargets({
      targets: [{ station_callsign: 'SQ8BWA', pin: 'A' }], mainPin: 'G', accounts,
    });
    assert.equal(c.state, 'ok');
  });

  test('znak stacji porównywany bez względu na wielkość liter', () => {
    const [c] = verifyTargets({ targets: [{ station_callsign: ' sn8n ' }], mainPin: 'G', accounts });
    assert.equal(c.state, 'ok');
  });

  test('brak danych konta → unknown, NIE blokuje', () => {
    // Krytyczne: brak łączności nie może wyglądać jak zła konfiguracja.
    const [c] = verifyTargets({ targets: [{ station_callsign: 'SN8N' }], mainPin: 'X', accounts });
    assert.equal(c.state, 'unknown');
    assert.equal(c.blocking, false);
  });

  test('starszy serwis (stations: null) → unknown, NIE missing-station', () => {
    // Potraktowanie braku pola jako pustej listy kazałoby ostrzegać przed
    // poprawną konfiguracją na każdym serwerze bez tego rozszerzenia.
    const acc = new Map([['G', konto('SQ8BWM', null)]]);
    const [c] = verifyTargets({ targets: [{ station_callsign: 'SN8N' }], mainPin: 'G', accounts: acc });
    assert.equal(c.state, 'unknown');
    assert.equal(c.blocking, false);
  });

  test('konto BEZ stacji (stations: []) → missing-station', () => {
    // Odwrotność poprzedniego: tu serwis odpowiedział i wiemy, że nie ma nic.
    const acc = new Map([['G', konto('SQ8BWM', [])]]);
    const [c] = verifyTargets({ targets: [{ station_callsign: 'SN8N' }], mainPin: 'G', accounts: acc });
    assert.equal(c.state, 'missing-station');
    assert.equal(c.blocking, true);
  });

  test('odrzucony klucz → bad-pin', () => {
    const acc = new Map([['A', { ok: false, code: 'INVALID_API_KEY', error: 'zły klucz' }]]);
    const [c] = verifyTargets({ targets: [{ station_callsign: 'SP1A', pin: 'A' }], mainPin: 'G', accounts: acc });
    assert.equal(c.state, 'bad-pin');
    assert.equal(c.blocking, true);
  });

  test('awaria sieci to NIE zły klucz', () => {
    // Bez kodu błędu nie wolno oskarżać konfiguracji — to mija samo.
    const acc = new Map([['A', { ok: false, error: 'Błąd połączenia: timeout' }]]);
    const [c] = verifyTargets({ targets: [{ station_callsign: 'SP1A', pin: 'A' }], mainPin: 'G', accounts: acc });
    assert.equal(c.state, 'unknown');
    assert.equal(c.blocking, false);
  });

  test('wyłączone API konta → api-disabled, ważniejsze niż lista stacji', () => {
    const acc = new Map([['G', { ...konto('SQ8BWM', ['SN8N']), apiEnabled: false }]]);
    const [c] = verifyTargets({ targets: [{ station_callsign: 'SN8N' }], mainPin: 'G', accounts: acc });
    assert.equal(c.state, 'api-disabled');
    assert.equal(c.blocking, true);
  });

  test('brak jakiegokolwiek PIN-u → no-pin', () => {
    const [c] = verifyTargets({ targets: [{ station_callsign: 'SN8N' }], mainPin: null, accounts });
    assert.equal(c.state, 'no-pin');
    assert.equal(c.blocking, true);
  });

  test('uprawnienia są, ale brak aktywnej akcji → ostrzeżenie bez blokady', () => {
    // Stan zależy od kalendarza, nie od konfiguracji: reguła wpisana dzień
    // przed akcją jest poprawna i nie wolno o niej straszyć przy zapisie.
    const acc = new Map([['G', konto('SQ8BWM', ['SN8N'], [])]]);
    const [c] = verifyTargets({ targets: [{ station_callsign: 'SN8N' }], mainPin: 'G', accounts: acc });
    assert.equal(c.state, 'no-active-action');
    assert.equal(c.blocking, false);
  });

  test('brak activeActions w odpowiedzi nie udaje braku akcji', () => {
    const acc = new Map([['G', konto('SQ8BWM', ['SN8N'], null)]]);
    const [c] = verifyTargets({ targets: [{ station_callsign: 'SN8N' }], mainPin: 'G', accounts: acc });
    assert.equal(c.state, 'ok');
  });

  test('wyłączona reguła też jest oceniana, ale nie trafia do ostrzeżenia', () => {
    const checks = verifyTargets({
      targets: [{ station_callsign: 'SP9XYZ', enabled: false }, { station_callsign: 'SP8ZZZ' }],
      mainPin: 'G', accounts,
    });
    assert.equal(checks[0].state, 'missing-station', 'stan liczymy, żeby dało się go pokazać');
    assert.equal(checks[0].enabled, false);
    assert.deepEqual(blockingTargets(checks).map((c) => c.station), ['SP8ZZZ'],
      'wyłączony cel nic nie wysyła, więc nie ma o czym ostrzegać');
  });

  test('pusta lista celów i śmieci na wejściu', () => {
    assert.deepEqual(verifyTargets({ targets: [], mainPin: 'G', accounts }), []);
    assert.deepEqual(verifyTargets({}), []);
    assert.deepEqual(verifyTargets({ targets: null, mainPin: 'G', accounts }), []);
  });
});

describe('isBlocking', () => {
  test('blokują tylko stany wynikające z konfiguracji', () => {
    for (const s of ['missing-station', 'bad-pin', 'api-disabled', 'no-pin']) {
      assert.equal(isBlocking(s), true, s);
    }
    for (const s of ['ok', 'unknown', 'no-active-action', 'cokolwiek']) {
      assert.equal(isBlocking(s), false, s);
    }
  });
});
