// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Konfiguracja i stan w postaci nadającej się do WYSŁANIA w zgłoszeniu błędu.
//
// Po co to istnieje: `config.json` w wersji z pulpitem zawiera JAWNY PIN, a
// mimo to jest pierwszą rzeczą, którą człowiek wkleja, gdy coś nie działa —
// bo nie ma czego wkleić zamiast. Ostrzeżenie w dokumentacji tego nie zmienia;
// łatwiejsza droga musi być bezpieczna.
//
// Dwie warstwy ochrony, bo jedna to za mało:
//  1. Budujemy z `editableConfig`, czyli z tej samej postaci, którą dostaje
//     okno: PIN-y zamaskowane, hasza hasła nie ma wcale.
//  2. Na KONIEC przeszukujemy gotowy wynik i podmieniamy każde wystąpienie
//     prawdziwych sekretów. Warstwa 1 opiera się na tym, że wszystkie ścieżki
//     są poprawne; warstwa 2 działa nawet wtedy, gdy któraś przestanie być.
import { writeFileSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { platform, arch, release, hostname } from 'node:os';
import { editableConfig } from './configedit.js';
import { recentLog } from './log.js';

/** Ile ostatnich wpisów logu dołączamy. Dość, żeby zobaczyć start i awarię. */
const WPISOW_LOGU = 200;

/**
 * Ostatnie wpisy logu — z PLIKU, nie z pamięci procesu.
 *
 * `recentLog()` trzyma bufor bieżącego procesu, więc w narzędziu z wiersza
 * poleceń (świeży proces) byłby pusty — a to jest właśnie przypadek malinki,
 * gdzie log jest najbardziej potrzebny. Plik czytamy tak, jak daemon ustala
 * jego położenie: obok `seen.json`, chyba że konfiguracja mówi inaczej.
 */
export function ogonLogu(cfg, ile = WPISOW_LOGU) {
  const dir = cfg?.logFile?.dir || (cfg?.queue?.seenFile ? dirname(cfg.queue.seenFile) : null);
  const plik = dir ? join(dir, cfg?.logFile?.name || 'bridge.log') : null;
  if (plik && existsSync(plik)) {
    try {
      const linie = readFileSync(plik, 'utf8').split('\n').filter(Boolean);
      return linie.slice(-ile);
    } catch { /* nieczytelny plik nie może zablokować zgłoszenia */ }
  }
  // Zapas: bufor w pamięci. W oknie na pulpicie bywa pełny, gdy plik wyłączono.
  return recentLog(ile);
}

/** Czym zastępujemy sekret, gdyby jakimś cudem trafił do wyniku. */
export const ZASLONA = '[USUNIĘTE-Z-ZGŁOSZENIA]';

/**
 * Zbiera sekrety, których w wyniku być NIE MOŻE.
 *
 * Krótkie wartości pomijamy: podmiana dwuznakowego „PIN-u" wycięłaby pół
 * tekstu i zrobiła zgłoszenie nieczytelnym, a i tak nie jest sekretem.
 */
export function sekretyDoUsuniecia(cfg) {
  const out = [];
  const dodaj = (v) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s.length >= 6) out.push(s);
  };
  dodaj(cfg?.radiodyplom?.pin);
  dodaj(cfg?.api?.auth?.passwordHash);
  for (const t of cfg?.forward?.targets || []) dodaj(t?.pin);
  return [...new Set(out)];
}

/** Podmienia sekrety w całej strukturze — także w tekstach zagnieżdżonych. */
export function zaslon(dane, sekrety) {
  if (!sekrety.length) return dane;
  const podmien = (s) => {
    let out = s;
    for (const sek of sekrety) out = out.split(sek).join(ZASLONA);
    return out;
  };
  const chodz = (x) => {
    if (typeof x === 'string') return podmien(x);
    if (Array.isArray(x)) return x.map(chodz);
    if (x && typeof x === 'object') {
      const o = {};
      for (const [k, v] of Object.entries(x)) o[k] = chodz(v);
      return o;
    }
    return x;
  };
  return chodz(dane);
}

/**
 * Buduje zgłoszenie.
 *
 * @param {object} opts
 * @param {object} opts.cfg      konfiguracja w pamięci (z sekretami)
 * @param {object} [opts.status] wynik StatusApi.status(), jeśli dostępny
 * @param {object} [opts.pkg]    package.json programu
 * @param {number} [opts.wpisow] ile wpisów logu dołączyć
 */
export function buildReport({ cfg, status = null, pkg = {}, wpisow = WPISOW_LOGU }) {
  const surowe = {
    zgloszenie: {
      utworzono: new Date().toISOString(),
      program: pkg.name || 'radiodyplom-bridge',
      wersja: pkg.version || null,
      // Nazwa maszyny bywa imieniem albo znakiem — zostawiamy, bo pomaga
      // powiązać zgłoszenie z opisem, a sekretem nie jest.
      maszyna: hostname(),
      system: `${platform()} ${arch()} (${release()})`,
      node: process.versions.node,
      electron: process.versions.electron || null,
    },
    // Ta sama postać, którą dostaje okno: PIN-y zamaskowane, hasła brak.
    konfiguracja: editableConfig(cfg),
    stan: status ? {
      kolejka: status.queue,
      nasluch: status.listener,
      api: status.api,
      radiodyplom: {
        profil: status.radiodyplom?.profile ?? null,
        pingOk: status.radiodyplom?.pingOk ?? null,
        pingError: status.radiodyplom?.pingError ?? null,
        dryRun: status.radiodyplom?.dryRun ?? null,
      },
      cele: (status.forward?.targets || []).map((t) => ({
        station_callsign: t.station_callsign,
        enabled: t.enabled,
        state: t.check?.state ?? null,
      })),
      problemy: status.problems,
      aktualizacja: status.update,
    } : null,
    log: ogonLogu(cfg, wpisow),
  };

  // Warstwa druga — patrz komentarz na górze pliku.
  return zaslon(surowe, sekretyDoUsuniecia(cfg));
}

/**
 * Zapisuje zgłoszenie do pliku i zwraca jego ścieżkę.
 *
 * Prawa 0600: plik nie zawiera sekretów, ale zawiera log ze znakami
 * korespondentów i nazwą maszyny. Nie ma powodu, żeby leżał otwarty.
 */
export function saveReport(katalog, dane) {
  const stempel = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const plik = join(katalog, `radiodyplom-zgloszenie-${stempel}.json`);
  writeFileSync(plik, `${JSON.stringify(dane, null, 2)}\n`, { mode: 0o600 });
  try { chmodSync(plik, 0o600); } catch { /* systemy plików bez praw POSIX */ }
  return plik;
}
