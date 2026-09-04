// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Dziennik wysłanych i liczenie statystyk.
//
// Dwie rzeczy, na których łatwo się przejechać i które pilnują tu testy:
//   1. QSO to nie kopia. Jedna łączność rozmnożona na trzy stacje to trzy
//      kopie, ale JEDNO QSO. Zlanie tego w jedno było dokładnie błędem
//      naprawianym na kartach zakładki Stan.
//   2. Do dziennika nie wolno wpuścić przejść próbnych ani duplikatów —
//      pierwsze nie opuściły komputera, drugie serwis miał już wcześniej.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Journal, readRecords, normalizeDate, normalizeTime, qsoKey, parseDay } from '../src/journal.js';
import { aggregate, filterRecords, filterOptions } from '../src/stats.js';
import { Worker } from '../src/worker.js';
import { setLevel } from '../src/log.js';

setLevel('error');

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rd-journal-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const rec = (over = {}) => ({
  at: '2026-09-03T20:30:02.246Z', date: '2026-09-03', time: '20:30',
  call: 'SP8PKX', station: 'SQ8BWM', operator: 'SQ8BWM',
  actions: ['295'], band: '80m', mode: 'SSB', source: 'QLog', ...over,
});

describe('normalizacja pól', () => {
  test('data z ADIF i z ISO', () => {
    assert.equal(normalizeDate('20260904'), '2026-09-04');
    assert.equal(normalizeDate('2026-09-04'), '2026-09-04');
    assert.equal(normalizeDate('bzdura'), null);
    assert.equal(normalizeDate(undefined), null);
  });

  test('godzina z sekundami i bez', () => {
    assert.equal(normalizeTime('202556'), '20:25');
    assert.equal(normalizeTime('2025'), '20:25');
    assert.equal(normalizeTime('20:25'), '20:25');
    assert.equal(normalizeTime('7'), null);
  });

  test('parseDay przyjmuje tylko ISTNIEJĄCE dni', () => {
    // REGRESJA: wzorzec `\d{4}-\d{2}-\d{2}` przepuszczał 2026-13-99, a data
    // idzie potem do porównań łańcuchowych — wynik byłby cicho bezsensowny.
    assert.equal(parseDay('2026-09-04'), '2026-09-04');
    assert.equal(parseDay('2026-02-29'), null, '2026 nie jest przestępny');
    assert.equal(parseDay('2024-02-29'), '2024-02-29', 'a 2024 jest');
    assert.equal(parseDay('2026-13-99'), null);
    assert.equal(parseDay('2026-02-30'), null, '30 lutego nie istnieje');
    assert.equal(parseDay('2026-00-10'), null);
    assert.equal(parseDay('wczoraj'), null);
    assert.equal(parseDay(''), null);
    assert.equal(parseDay(null), null);
  });

  test('klucz QSO nie zależy od znaku stacji', () => {
    // Sedno rozróżnienia QSO od kopii.
    assert.equal(qsoKey(rec({ station: 'SN8N' })), qsoKey(rec({ station: 'SQ8BWA' })));
    assert.notEqual(qsoKey(rec()), qsoKey(rec({ call: 'SP9XYZ' })));
  });
});

describe('Journal — zapis', () => {
  test('dopisuje po jednej linii, plik na miesiąc', () => {
    const j = new Journal({ dir }).init();
    j.append(rec());
    j.append(rec({ station: 'SN8N' }));
    j.append(rec({ date: '2026-08-31', at: '2026-08-31T20:00:00.000Z' }));

    const wrzesien = readFileSync(join(dir, 'sent-2026-09.jsonl'), 'utf8').trim().split('\n');
    assert.equal(wrzesien.length, 2);
    assert.ok(existsSync(join(dir, 'sent-2026-08.jsonl')), 'sierpień w osobnym pliku');
  });

  test('PIN nigdy nie trafia do dziennika', () => {
    const j = new Journal({ dir }).init();
    j.record({
      payload: { api_key: 'TAJNY-PIN', callsign: 'SP1AAA', station_callsign: 'SN0LPU',
        qso_date: '20260904', time_on: '103000', band: '40m', mode: 'SSB' },
      savedTo: [295], source: 'QLog',
    });
    const tekst = readFileSync(join(dir, 'sent-2026-09.jsonl'), 'utf8');
    assert.ok(!tekst.includes('TAJNY-PIN'), 'sekret nie ma prawa być w dzienniku');
    const r = JSON.parse(tekst.trim());
    assert.equal(r.date, '2026-09-04');
    assert.equal(r.time, '10:30');
    assert.deepEqual(r.actions, ['295']);
  });

  test('brak katalogu nie wywala programu', () => {
    // Statystyka jest wygodą; jej awaria nie może zatrzymać wysyłki QSO.
    const j = new Journal({ dir: '/nie/wolno/mi/tu/pisac' }).init();
    assert.equal(j.ready, false);
    assert.equal(j.append(rec()), false, 'zwraca false, ale nie rzuca');
  });
});

describe('readRecords', () => {
  test('czyta wszystkie miesiące i filtruje datami QSO', () => {
    const j = new Journal({ dir }).init();
    j.append(rec({ date: '2026-08-31', at: '2026-08-31T20:00:00Z' }));
    j.append(rec({ date: '2026-09-01' }));
    j.append(rec({ date: '2026-09-03' }));

    assert.equal(readRecords(dir).length, 3);
    assert.equal(readRecords(dir, { from: '2026-09-01' }).length, 2);
    assert.equal(readRecords(dir, { to: '2026-08-31' }).length, 1);
    assert.equal(readRecords(dir, { from: '2026-09-01', to: '2026-09-01' }).length, 1);
  });

  test('ucięta ostatnia linia nie odbiera dostępu do całej statystyki', () => {
    // Dziennik jest dopisywany, więc ubicie procesu w trakcie zapisu może
    // zostawić połowę linii. Wywalenie się na tym byłoby najgorsze.
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'sent-2026-09.jsonl'),
      `${JSON.stringify(rec())}\n${JSON.stringify(rec({ call: 'SP9XYZ' })).slice(0, 30)}`);
    const r = readRecords(dir);
    assert.equal(r.length, 1);
    assert.equal(r[0].call, 'SP8PKX');
  });

  test('brak katalogu to pusta lista, nie wyjątek', () => {
    assert.deepEqual(readRecords(join(dir, 'nie-ma')), []);
    assert.deepEqual(readRecords(null), []);
  });
});

describe('aggregate', () => {
  const dane = [
    rec(), rec({ station: 'SQ8BWA', operator: 'SQ8BWA' }), rec({ station: 'SN8N', operator: 'SQ8BWA' }),
    rec({ date: '2026-09-04', time: '10:00', call: 'SP9ABC', band: '40m', mode: 'CW', actions: ['295', '300'] }),
  ];

  test('QSO liczone osobno od kopii', () => {
    const a = aggregate(dane);
    assert.equal(a.total.copies, 4);
    assert.equal(a.total.qso, 2, 'trzy kopie jednego QSO to jedno QSO');
    assert.equal(a.total.days, 2);
    assert.equal(a.total.first, '2026-09-03');
    assert.equal(a.total.last, '2026-09-04');
  });

  test('kopia w kilku akcjach liczy się w każdej', () => {
    const a = aggregate(dane);
    assert.deepEqual(a.perAction.map((x) => [x.key, x.copies, x.qso]),
      [['295', 4, 2], ['300', 1, 1]]);
  });

  test('dni rosnąco, pozostałe przekroje malejąco', () => {
    const a = aggregate(dane);
    assert.deepEqual(a.perDay.map((x) => x.key), ['2026-09-03', '2026-09-04']);
    assert.equal(a.perBand[0].key, '80m', 'najliczniejsze pasmo na górze');
  });

  test('operator liczony po kopiach, nie po QSO', () => {
    // SQ8BWA figuruje w dwóch kopiach jednego QSO — to nadal jedno QSO.
    const a = aggregate(dane);
    const bwa = a.perOperator.find((x) => x.key === 'SQ8BWA');
    assert.equal(bwa.copies, 2);
    assert.equal(bwa.qso, 1);
  });

  test('distinct podaje PRAWDZIWĄ liczbę różnych wartości, nie długość listy', () => {
    // REGRESJA: `topCalls` było przycinane do 20, okno pokazywało 10 i pisało
    // „i 10 więcej" — przy 237 pracowanych znakach. Liczba wyglądała
    // wiarygodnie i była nieprawdziwa. Źródłem musi być pełny przekrój.
    const duzo = [];
    for (let i = 0; i < 120; i++) {
      duzo.push(rec({ call: `SP${i}AA`, date: '2026-09-03', time: `10:${String(i % 60).padStart(2, '0')}` }));
    }
    const a = aggregate(duzo);
    assert.equal(a.distinct.calls, 120, 'pełna liczba znaków');
    assert.equal(a.topCalls.length, 50, 'lista przycięta, ale to nie ta liczba');
    assert.ok(a.distinct.calls > a.topCalls.length, 'i musi być większa od listy');
  });

  test('distinct dla każdego przekroju', () => {
    const a = aggregate(dane);
    assert.equal(a.distinct.days, 2);
    assert.equal(a.distinct.actions, 2, '295 i 300');
    assert.equal(a.distinct.operators, 2);
    assert.equal(a.distinct.stations, 3);
    assert.equal(a.distinct.bands, 2);
    assert.equal(a.distinct.modes, 2);
    assert.equal(a.distinct.calls, 2);
    // Liczby muszą zgadzać się z długością nieprzyciętych list.
    assert.equal(a.distinct.days, a.perDay.length);
    assert.equal(a.distinct.stations, a.perStation.length);
  });

  test('puste pola nie tworzą przekroju „null"', () => {
    const a = aggregate([rec({ operator: null, band: '' })]);
    assert.deepEqual(a.perOperator, []);
    assert.deepEqual(a.perBand, []);
  });

  test('pusty dziennik i śmieci na wejściu', () => {
    for (const wejscie of [[], null, undefined]) {
      const a = aggregate(wejscie);
      assert.equal(a.total.copies, 0);
      assert.equal(a.total.qso, 0);
      assert.equal(a.total.first, null);
    }
  });
});

describe('zawężanie po operatorze i stacji', () => {
  const dane = [
    rec(), rec({ station: 'SQ8BWA', operator: 'SQ8BWA' }), rec({ station: 'SN8N', operator: 'SQ8BWA' }),
    rec({ date: '2026-09-04', time: '10:00', call: 'SP9ABC', station: 'SN8N', operator: 'SQ8BWA' }),
  ];

  test('po operatorze', () => {
    const w = filterRecords(dane, { operator: 'SQ8BWA' });
    assert.equal(w.length, 3);
    const a = aggregate(w);
    assert.equal(a.total.qso, 2, 'dwie różne łączności');
    assert.equal(a.total.copies, 3);
  });

  test('po znaku stacji', () => {
    // Kopie jednego QSO mają RÓŻNE znaki stacji, więc filtr po stacji pokazuje
    // te QSO, które poszły pod tym znakiem — po jednej kopii na QSO.
    const a = aggregate(filterRecords(dane, { station: 'SN8N' }));
    assert.equal(a.total.copies, 2);
    assert.equal(a.total.qso, 2);
  });

  test('oba filtry razem zawężają, nie sumują', () => {
    assert.equal(filterRecords(dane, { operator: 'SQ8BWM', station: 'SN8N' }).length, 0,
      'SQ8BWM nie logował spod SN8N');
    assert.equal(filterRecords(dane, { operator: 'SQ8BWA', station: 'SN8N' }).length, 2);
  });

  test('bez filtrów oddaje wejście, wielkość liter bez znaczenia', () => {
    assert.equal(filterRecords(dane, {}).length, 4);
    assert.equal(filterRecords(dane).length, 4);
    assert.equal(filterRecords(dane, { station: ' sn8n ' }).length, 2);
  });

  test('nieistniejąca wartość daje pusto, nie wszystko', () => {
    // Gdyby filtr „nie pasuje" oznaczał „pokaż wszystko", użytkownik zobaczyłby
    // pełne statystyki w przekonaniu, że patrzy na jedną stację.
    assert.deepEqual(filterRecords(dane, { station: 'SP9XYZ' }), []);
  });

  test('listy wyboru tylko z wartości, które w danych są', () => {
    const o = filterOptions(dane);
    assert.deepEqual(o.operators, ['SQ8BWA', 'SQ8BWM']);
    assert.deepEqual(o.stations, ['SN8N', 'SQ8BWA', 'SQ8BWM']);
  });

  test('listy wyboru pomijają puste pola i śmieci', () => {
    const o = filterOptions([rec({ operator: null }), rec({ station: '' }), ...dane]);
    assert.ok(!o.operators.includes(''), 'puste nie jest opcją');
    assert.deepEqual(filterOptions([]).stations, []);
    assert.deepEqual(filterOptions(null).operators, []);
  });
});

describe('worker → dziennik', () => {
  function fakeStore() {
    return { items: [], list() { return this.items; }, complete() { this.items = []; },
      fail() { this.items = []; }, update() {} };
  }
  const item = () => ({
    key: 'k', attempts: 0, nextAt: 0, meta: { source: 'qlog' },
    payload: { callsign: 'SP7VCL', station_callsign: 'SN0LPU', operator: 'SQ8BWM',
      qso_date: '20260904', time_on: '1030', band: '40m', mode: 'SSB', api_key: 'X' },
  });
  const makeWorker = (res, journal) => new Worker({
    store: fakeStore(),
    client: { async upload() { return res; } },
    queue: { maxAttempts: 20, baseDelayMs: 1, maxDelayMs: 2 },
    rateLimit: { maxPerMinute: 1000, minSpacingMs: 0 },
    journal,
  });

  test('prawdziwa wysyłka trafia do dziennika', async () => {
    const j = new Journal({ dir }).init();
    await makeWorker({ ok: true, savedTo: ['295'] }, j)._process(item());
    const r = readRecords(dir);
    assert.equal(r.length, 1);
    assert.equal(r[0].call, 'SP7VCL');
    assert.equal(r[0].source, 'qlog');
    assert.deepEqual(r[0].actions, ['295']);
  });

  test('przejście PRÓBNE nie trafia do dziennika', async () => {
    // Zamówione wprost: QSO, które nie opuściło komputera, nie jest wysłane.
    const j = new Journal({ dir }).init();
    await makeWorker({ ok: true, dryRun: true }, j)._process(item());
    assert.deepEqual(readRecords(dir), []);
  });

  test('duplikat odbity przez serwis nie trafia do dziennika', async () => {
    // Serwis miał to QSO już wcześniej; drugi wpis zawyżałby statystykę.
    const j = new Journal({ dir }).init();
    await makeWorker({ ok: true, duplicate: true }, j)._process(item());
    assert.deepEqual(readRecords(dir), []);
  });

  test('odrzucenie nie trafia do dziennika', async () => {
    const j = new Journal({ dir }).init();
    await makeWorker({ ok: false, permanent: true, code: 'NOT_SAVED', error: 'brak akcji' }, j)
      ._process(item());
    assert.deepEqual(readRecords(dir), []);
  });

  test('worker bez dziennika działa normalnie', async () => {
    // Dziennik jest opcjonalny — rdzeń musi wstać i wysyłać także bez niego.
    const w = makeWorker({ ok: true, savedTo: ['295'] }, null);
    await w._process(item());
    assert.equal(w.counters.sent, 1);
  });
});
