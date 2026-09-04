// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Zliczanie statystyk z dziennika wysłanych.
//
// Liczymy PRZY ODPYTANIU, a nie liczniki na bieżąco. Liczniki trzymane na żywo
// trzeba by migrować przy każdej nowej przekrojówce, a dziennik pozwala dodać
// nowy przekrój bez ruszania danych.
//
// Wszędzie podajemy DWIE liczby, bo to dwa różne pytania:
//   QSO   — ile łączności przeprowadził operator,
//   kopie — ile razy mostek wysłał je na serwis (fan-out mnoży).
// Mieszanie ich jest dokładnie tym błędem, który naprawialiśmy na kartach Stanu.
import { qsoKey } from './journal.js';

/** Jeden przekrój: klucz → {qso, copies}. */
function grupuj(records, keyFn) {
  const mapa = new Map();
  for (const r of records) {
    for (const k of keyFn(r)) {
      if (k === null || k === undefined || k === '') continue;
      let w = mapa.get(k);
      if (!w) { w = { key: String(k), copies: 0, qso: new Set() }; mapa.set(k, w); }
      w.copies += 1;
      w.qso.add(qsoKey(r));
    }
  }
  return [...mapa.values()].map((w) => ({ key: w.key, copies: w.copies, qso: w.qso.size }));
}

const wgKopii = (a, b) => b.copies - a.copies || a.key.localeCompare(b.key);
const wgKlucza = (a, b) => a.key.localeCompare(b.key);

/**
 * Wszystkie przekroje z jednego przejścia po wpisach.
 * @param {object[]} records wpisy dziennika
 */
export function aggregate(records = []) {
  const lista = Array.isArray(records) ? records : [];
  const wszystkieQso = new Set(lista.map(qsoKey));

  return {
    total: {
      qso: wszystkieQso.size,
      copies: lista.length,
      // Dni Z ŁĄCZNOŚCIAMI, nie długość zakresu — „średnio 30 QSO dziennie"
      // liczone przez dni bez pracy byłoby bez sensu.
      days: new Set(lista.map((r) => r.date).filter(Boolean)).size,
      first: lista.reduce((m, r) => (r.date && (!m || r.date < m) ? r.date : m), null),
      last: lista.reduce((m, r) => (r.date && (!m || r.date > m) ? r.date : m), null),
    },
    // Dni rosnąco — wykres czasu czyta się od lewej.
    perDay: grupuj(lista, (r) => [r.date]).sort(wgKlucza),
    // Jedna kopia może trafić do kilku akcji, więc liczy się w każdej z nich.
    perAction: grupuj(lista, (r) => (Array.isArray(r.actions) && r.actions.length ? r.actions : [null])).sort(wgKopii),
    perOperator: grupuj(lista, (r) => [r.operator]).sort(wgKopii),
    perStation: grupuj(lista, (r) => [r.station]).sort(wgKopii),
    perBand: grupuj(lista, (r) => [r.band]).sort(wgKopii),
    perMode: grupuj(lista, (r) => [r.mode]).sort(wgKopii),
    perSource: grupuj(lista, (r) => [r.source]).sort(wgKopii),
    // Najczęściej pracowane znaki — przydaje się do wyłapania pomyłki w loggerze.
    topCalls: grupuj(lista, (r) => [r.call]).sort(wgKopii).slice(0, 20),
  };
}
