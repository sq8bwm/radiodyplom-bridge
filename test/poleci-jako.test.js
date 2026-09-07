// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// „Poleci jako": jakim znakiem stacji zostanie zapisane QSO i kiedy ostrzegamy.
//
// Po co: konfigurację fan-outu widać wyłącznie w zakładce Konfiguracja, w tabeli
// z wieloma wierszami. Mostek uruchamia się ręcznie i rzadko (autostartu
// świadomie nie robimy), więc łatwo zapomnieć, co było ustawione ostatnim razem
// i zalogować prywatne QSO jako stacja akcji — znakiem POPRAWNYM, którego nikt
// nie odrzuci.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarizeTargets } from '../src/fanout.js';

const CELE = [
  { station_callsign: 'SN8N', operator: 'SQ8BWA', enabled: true },
  { station_callsign: 'SQ8BWA', enabled: false },
  { station_callsign: 'SP8X', enabled: false },
];

describe('co poleci', () => {
  test('liczą się tylko cele włączone', () => {
    const p = summarizeTargets(CELE, null);
    assert.deepEqual(p.aktywne, [{ station: 'SN8N', operator: 'SQ8BWA' }]);
    assert.equal(p.wylaczone, 2);
  });

  test('brak włączonych celów = znak z loggera', () => {
    // To też jest stan, którego dotąd nie było widać w oknie.
    const p = summarizeTargets(CELE.map((t) => ({ ...t, enabled: false })), 'SQ8BWM');
    assert.equal(p.zeZnakuLoggera, true);
    assert.equal(p.aktywne.length, 0);
  });

  test('pusta lista celów zachowuje się jak same wyłączone', () => {
    assert.equal(summarizeTargets([], 'SQ8BWM').zeZnakuLoggera, true);
    assert.equal(summarizeTargets(undefined, 'SQ8BWM').zeZnakuLoggera, true);
  });
});

describe('ostrzeżenie o niezgodnym znaku', () => {
  test('ostrzega, gdy ŻADEN włączony cel nie loguje na znak z loggera', () => {
    // Sytuacja: siadasz wieczorem do zwykłego logowania jako SQ8BWM, a mostek
    // stoi z włączonym celem akcji. QSO trafi wyłącznie do dziennika akcji.
    const p = summarizeTargets(CELE, 'SQ8BWM');
    assert.equal(p.niezgodnyZnak, true);
    assert.equal(p.znakZLoggera, 'SQ8BWM');
  });

  test('NIE ostrzega, gdy znak z loggera jest wśród włączonych celów', () => {
    assert.equal(summarizeTargets(CELE, 'SN8N').niezgodnyZnak, false);
  });

  test('NIE ostrzega przy rozmnażaniu, jeśli własny znak też jest celem', () => {
    // Rozjazd sam w sobie jest normalny i zamierzony — ostrzeganie o nim
    // zawsze zrobiłoby z tego szum, który się ignoruje.
    const wiele = [
      { station_callsign: 'SQ8BWM', enabled: true },
      { station_callsign: 'SN8N', enabled: true },
      { station_callsign: 'SN0LPU', enabled: true },
    ];
    assert.equal(summarizeTargets(wiele, 'SQ8BWM').niezgodnyZnak, false);
  });

  test('NIE ostrzega, dopóki nie przyszło żadne QSO', () => {
    // Bez datagramu nie ma z czym porównywać; ostrzeżenie „na zapas" byłoby
    // zgadywaniem i uczyłoby ignorowania tego panelu.
    assert.equal(summarizeTargets(CELE, null).niezgodnyZnak, false);
    assert.equal(summarizeTargets(CELE, '').niezgodnyZnak, false);
  });

  test('NIE ostrzega, gdy nie ma włączonych celów', () => {
    // Wtedy QSO leci właśnie znakiem z loggera — nie ma rozjazdu.
    const p = summarizeTargets(CELE.map((t) => ({ ...t, enabled: false })), 'SQ8BWM');
    assert.equal(p.niezgodnyZnak, false);
  });

  test('porównanie znosi wielkość liter i spacje', () => {
    // QLog potrafi przysłać małymi literami; ostrzeżenie z tego powodu byłoby
    // fałszywym alarmem, a fałszywy alarm uczy ignorowania prawdziwych.
    assert.equal(summarizeTargets([{ station_callsign: 'sn8n', enabled: true }], ' SN8N ')
      .niezgodnyZnak, false);
  });
});

describe('panel w oknie', () => {
  const H = readFileSync('ui/index.html', 'utf8');
  const R = readFileSync('ui/renderer.js', 'utf8');
  const S = readFileSync('ui/strings.js', 'utf8');

  test('panel jest na zakładce Stan, nie tylko w Konfiguracji', () => {
    const stan = H.slice(H.indexOf('<section id="stan"'), H.indexOf('<section id="kolejka"'));
    assert.match(stan, /id="willSendInfo"/);
    assert.match(stan, /id="willSendWarn"/);
  });

  test('ostrzeżenie w oknie mówi OBA znaki', () => {
    const m = S.match(/'willSend\.mismatch': '([^']+)'/);
    assert.ok(m, 'brak komunikatu po polsku');
    assert.match(m[1], /\{logger\}/);
    assert.match(m[1], /\{cele\}/);
  });

  test('okno bierze gotowe podsumowanie z API, nie liczy go samo', () => {
    // Dwie implementacje tej samej reguły rozjechałyby się przy pierwszej
    // zmianie — a to reguła, która ma ostrzegać przed cichym błędem.
    assert.match(R, /s\.forward\?\.podsumowanie/);
    assert.match(R, /p\.niezgodnyZnak/);
  });
});
