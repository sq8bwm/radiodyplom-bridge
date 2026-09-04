// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Dziennik wysłanych QSO — jedna linia na wysłaną kopię.
//
// Po co osobny plik, skoro jest kolejka i `seen.json`: kolejka trzyma tylko to,
// co jeszcze nie poszło, a `seen.json` — same klucze deduplikacji i liczniki.
// Historii pojedynczych QSO nie było z czego odtworzyć, więc „ile QSO w sobotę"
// albo „ile na której akcji" było pytaniem bez odpowiedzi.
//
// Format: JSON Lines, plik na miesiąc. Dopisywanie jednej linii jest odporne na
// ubicie procesu (nie przepisujemy pliku), a podział na miesiące trzyma odczyty
// tanie, gdy dziennik urośnie.
//
// Czego tu NIE MA i dlaczego:
//  - przejść próbnych — QSO, które nie opuściło komputera, nie jest wysłane
//    i nie ma go czego wliczać do statystyki (ustalone wprost 2026-09-04);
//  - duplikatów odbitych przez serwis — te QSO serwis miał już wcześniej,
//    więc zapisanie ich drugi raz zawyżałoby liczby;
//  - PIN-ów. Nigdy.
import { appendFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './log.js';

/** `20260904` → `2026-09-04`. Zwraca null, gdy nie da się odczytać. */
export function normalizeDate(raw) {
  const s = String(raw || '').trim();
  let m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/**
 * Data z żądania — tylko ISTNIEJĄCY dzień, w postaci `RRRR-MM-DD`.
 *
 * Sam kształt nie wystarcza: `2026-13-99` przechodzi wzorzec, a potem idzie do
 * porównań łańcuchowych i daje cicho pusty albo pełny wynik, bez śladu błędu.
 */
export function parseDay(v) {
  const s = String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

/** `202556` albo `2025` → `20:25`. */
export function normalizeTime(raw) {
  const s = String(raw || '').replace(/[^0-9]/g, '');
  if (s.length < 4) return null;
  return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
}

/**
 * Klucz jednego QSO — po nim rozróżniamy QSO od kopii.
 * Jedno QSO rozmnożone na trzy stacje to trzy kopie, ale jedno QSO.
 */
export function qsoKey(rec) {
  return `${rec.date || '?'}|${rec.time || '?'}|${rec.call || '?'}`;
}

export class Journal {
  constructor({ dir }) {
    this.dir = dir;
    this.ready = false;
  }

  init() {
    try {
      mkdirSync(this.dir, { recursive: true });
      this.ready = true;
    } catch (err) {
      // Brak dziennika nie może zatrzymać przekazywania QSO.
      log.warn(`Nie mogę utworzyć katalogu dziennika (${this.dir}): ${err.message}`);
      this.ready = false;
    }
    return this;
  }

  /** Plik dla podanej daty QSO (albo dla dzisiejszej, gdy daty nie ma). */
  fileFor(date) {
    const miesiac = (normalizeDate(date) || new Date().toISOString().slice(0, 10)).slice(0, 7);
    return join(this.dir, `sent-${miesiac}.jsonl`);
  }

  /**
   * Dopisuje jeden wpis. Nigdy nie rzuca — statystyka jest wygodą,
   * a nie warunkiem pracy mostka.
   */
  append(rec) {
    if (!this.ready) return false;
    try {
      appendFileSync(this.fileFor(rec.date), `${JSON.stringify(rec)}\n`);
      return true;
    } catch (err) {
      log.warn(`Nie mogę dopisać do dziennika: ${err.message}`);
      return false;
    }
  }

  /** Zapis z ładunku wysłanego QSO. */
  record({ payload, savedTo, source, at = new Date() }) {
    const { api_key: _pin, ...bez } = payload || {};
    return this.append({
      at: at.toISOString(),
      date: normalizeDate(bez.qso_date),
      time: normalizeTime(bez.time_on),
      call: bez.callsign || null,
      station: bez.station_callsign || null,
      operator: bez.operator || null,
      actions: Array.isArray(savedTo) ? savedTo.map((a) => String(a)) : [],
      band: bez.band || null,
      mode: bez.mode || null,
      source: source || null,
    });
  }
}

/**
 * Czyta wpisy dziennika. `from`/`to` to daty QSO w postaci `RRRR-MM-DD`
 * (włącznie); brak oznacza „bez ograniczenia".
 *
 * Linie połamane pomijamy po cichu: dziennik jest dopisywany, więc ostatnia
 * linia może być ucięta przez ubicie procesu w trakcie zapisu. Wywalenie się
 * na tym odebrałoby dostęp do CAŁEJ statystyki.
 */
export function readRecords(dir, { from = null, to = null } = {}) {
  if (!dir || !existsSync(dir)) return [];
  let pliki;
  try {
    pliki = readdirSync(dir).filter((f) => /^sent-\d{4}-\d{2}\.jsonl$/.test(f)).sort();
  } catch {
    return [];
  }

  // Miesiące poza zakresem pomijamy bez otwierania pliku.
  const miesiac = (f) => f.slice(5, 12);
  if (from) pliki = pliki.filter((f) => miesiac(f) >= from.slice(0, 7));
  if (to) pliki = pliki.filter((f) => miesiac(f) <= to.slice(0, 7));

  const out = [];
  for (const f of pliki) {
    let tekst;
    try { tekst = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
    for (const linia of tekst.split('\n')) {
      if (!linia.trim()) continue;
      let rec;
      try { rec = JSON.parse(linia); } catch { continue; }
      if (from && (rec.date || '') < from) continue;
      if (to && (rec.date || '') > to) continue;
      out.push(rec);
    }
  }
  return out;
}
