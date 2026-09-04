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

/**
 * Zawężenie wpisów do wybranego operatora i/albo znaku stacji.
 *
 * Uwaga na znaczenie: kopie jednego QSO mają RÓŻNE znaki stacji i różnych
 * operatorów. Filtr po stacji `SN8N` pokazuje więc te QSO, które poszły
 * pod tym znakiem — a nie „wszystkie QSO z sesji, w której leciało też SN8N".
 */
export function filterRecords(records, { operator = null, station = null } = {}) {
  const lista = Array.isArray(records) ? records : [];
  const op = operator ? String(operator).trim().toUpperCase() : null;
  const st = station ? String(station).trim().toUpperCase() : null;
  if (!op && !st) return lista;
  return lista.filter((r) => (!op || String(r.operator || '').toUpperCase() === op)
    && (!st || String(r.station || '').toUpperCase() === st));
}

/** Wartości do wyboru w filtrach — tylko te, które w danych naprawdę są. */
export function filterOptions(records) {
  const lista = Array.isArray(records) ? records : [];
  const zbior = (f) => [...new Set(lista.map(f).filter(Boolean))]
    .map((x) => String(x).toUpperCase()).sort();
  return { operators: zbior((r) => r.operator), stations: zbior((r) => r.station) };
}

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

  // Znaki korespondentów liczymy w całości, a listę dopiero potem przycinamy.
  //
  // Po co osobno: przycięta lista NIE MOŻE być źródłem liczby „i ile więcej".
  // Tak było na początku — API oddawało 20 najczęstszych, okno pokazywało 10
  // i pisało „i 10 więcej", przy 237 pracowanych znakach. Liczba wyglądała
  // wiarygodnie i była nieprawdziwa.
  const znaki = grupuj(lista, (r) => [r.call]).sort(wgKopii);
  const dni = grupuj(lista, (r) => [r.date]).sort(wgKlucza);
  const akcje = grupuj(lista, (r) => (Array.isArray(r.actions) && r.actions.length ? r.actions : [null])).sort(wgKopii);
  const operatorzy = grupuj(lista, (r) => [r.operator]).sort(wgKopii);
  const stacje = grupuj(lista, (r) => [r.station]).sort(wgKopii);
  const pasma = grupuj(lista, (r) => [r.band]).sort(wgKopii);
  const emisje = grupuj(lista, (r) => [r.mode]).sort(wgKopii);
  const zrodla = grupuj(lista, (r) => [r.source]).sort(wgKopii);

  return {
    // Ile RÓŻNYCH wartości ma każdy przekrój — niezależnie od tego, ile
    // pozycji zmieściło się na liście. Stąd bierze się „i ile więcej".
    distinct: {
      days: dni.length,
      actions: akcje.length,
      operators: operatorzy.length,
      stations: stacje.length,
      bands: pasma.length,
      modes: emisje.length,
      sources: zrodla.length,
      calls: znaki.length,
    },
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
    perDay: dni,
    // Jedna kopia może trafić do kilku akcji, więc liczy się w każdej z nich.
    perAction: akcje,
    perOperator: operatorzy,
    perStation: stacje,
    perBand: pasma,
    perMode: emisje,
    perSource: zrodla,
    // Najczęściej pracowane znaki. Przycięte, bo przy kilku latach pracy byłyby
    // to tysiące wierszy — ale `distinct.calls` niesie pełną liczbę.
    topCalls: znaki.slice(0, 50),
  };
}
