#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Odtworzenie dziennika wysłanych z plików logu.
//
//   node src/tools/import-log.js <plik.log> [...]           # dopisz
//   node src/tools/import-log.js --dry <plik.log>           # tylko pokaż
//   node src/tools/import-log.js --dir /inny/katalog <plik> # inny dziennik
//   node src/tools/import-log.js --skip-call SN0TEST <plik> # pomiń znak (można wielokrotnie)
//
// Po co: dziennik wysłanych powstał 2026-09-04, a QSO leciały od 31 sierpnia.
// Cała historia siedzi w logach — w nich jest wszystko poza datą samego QSO.
//
// CZEGO LOG NIE MA: pól `qso_date` i `time_on`, czyli czasu ŁĄCZNOŚCI. Bierzemy
// więc czas wpisu z logu. Jest w UTC, tak jak daty w ADIF, a mostek wysyła QSO
// w kilka sekund po zalogowaniu, więc dzień wychodzi ten sam. Wpisy odtworzone
// mają `imported: true`, żeby było widać, skąd się wzięły.
import { readFileSync, existsSync } from 'node:fs';
import { Journal, readRecords, normalizeTime } from '../journal.js';
import { loadConfig } from '../config.js';
import { setLevel } from '../log.js';

setLevel('warn');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const iDir = args.indexOf('--dir');
const dirArg = iDir >= 0 ? args[iDir + 1] : null;
// Znaki do pominięcia — QSO testowe, usunięte potem z serwisu. Świadoma
// decyzja użytkownika: sami niczego nie odsiewamy po kształcie znaku, bo
// „SN0TEST" bywa prawdziwym znakiem okolicznościowym.
const pomijaneZnaki = new Set();
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--skip-call' && args[i + 1]) pomijaneZnaki.add(args[i + 1].toUpperCase());
}
const zajete = new Set();
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dir' || args[i] === '--skip-call') zajete.add(i + 1);
}
const pliki = args.filter((a, i) => !a.startsWith('--') && !zajete.has(i));

if (!pliki.length) {
  console.error('Podaj co najmniej jeden plik logu.\n'
    + '  node src/tools/import-log.js [--dry] [--dir KATALOG] plik.log [...]');
  process.exit(1);
}

// „Nowe QSO [QLog]: SP5EWX → SN0LPU {"band":"40m","mode":"SSB","operator":"SQ8BWA"}"
const NOWE = /^(\S+)\s+\[INFO\]\s+Nowe QSO \[([^\]]+)\]:\s+(\S+)\s+→\s+(\S+)\s*(\{.*\})?\s*$/;
// „QSO SP5EWX zapisane {"akcje":[295],"source":"QLog"}"
const ZAPISANE = /^(\S+)\s+\[INFO\]\s+QSO (\S+) zapisane\s*(\{.*\})?\s*$/;
// „[dry-run] POST pominięty {"callsign":"SN0TST",…}" — do 0.1.6 przejście próbne
// meldowało się potem jako „zapisane", więc bez tego sygnału trafiłoby do
// statystyki jako prawdziwa wysyłka. Użytkownik wprost tego nie chce.
const PROBNE = /^\S+\s+\[INFO\]\s+\[dry-run\] POST pominięty\s*(\{.*\})?\s*$/;

const journalDir = dirArg || loadConfig().queue.journalDir;
const journal = new Journal({ dir: journalDir }).init();

/** Klucz odporny na to, że czas wysłania czytany jest z dwóch różnych źródeł. */
const kluczKopii = (r) => `${r.date}|${r.time}|${r.call}|${r.station}`;

const juzMam = new Set(readRecords(journalDir).map(kluczKopii));
const doZapisu = [];
const widziane = new Set(juzMam);
let linii = 0; let nowe = 0; let zapisane = 0; let bezPary = 0; let duplikaty = 0;
let probne = 0; let pominieteZnaki = 0;

for (const plik of pliki) {
  if (!existsSync(plik)) { console.error(`Pomijam, nie ma pliku: ${plik}`); continue; }

  // Kolejka oczekujących „Nowe QSO" per znak. Jedno QSO daje N wpisów (po jednym
  // na cel), potem N potwierdzeń — parujemy pierwsze z pierwszym, w kolejności.
  const oczekujace = new Map();
  // Ile przejść próbnych czeka na swoje „zapisane", per znak.
  const probneNaZnak = new Map();

  for (const linia of readFileSync(plik, 'utf8').split('\n')) {
    if (!linia.trim()) continue;
    linii += 1;

    let m = PROBNE.exec(linia);
    if (m) {
      let call = null;
      try { call = (JSON.parse(m[1] || '{}').callsign || '').toUpperCase() || null; } catch { /* trudno */ }
      if (call) probneNaZnak.set(call, (probneNaZnak.get(call) || 0) + 1);
      continue;
    }

    m = NOWE.exec(linia);
    if (m) {
      const [, ts, source, call, station, json] = m;
      let extra = {};
      try { extra = json ? JSON.parse(json) : {}; } catch { /* pole opcjonalne */ }
      if (!oczekujace.has(call)) oczekujace.set(call, []);
      oczekujace.get(call).push({
        ts, source, call, station,
        band: extra.band || null,
        mode: extra.mode || null,
        operator: extra.operator || null,
      });
      nowe += 1;
      continue;
    }

    m = ZAPISANE.exec(linia);
    if (!m) continue;
    zapisane += 1;
    const [, ts, call, json] = m;
    let extra = {};
    try { extra = json ? JSON.parse(json) : {}; } catch { /* pole opcjonalne */ }

    // Przejście próbne: QSO nie opuściło komputera, więc do dziennika nie idzie.
    // Zabieramy też jego „Nowe QSO", żeby nie sparowało się z następnym QSO.
    const ileProbnych = probneNaZnak.get(call) || 0;
    const brakAkcji = !Object.prototype.hasOwnProperty.call(extra, 'akcje');
    if (ileProbnych > 0 || brakAkcji) {
      if (ileProbnych > 0) probneNaZnak.set(call, ileProbnych - 1);
      const k = oczekujace.get(call);
      if (k && k.length) k.shift();
      probne += 1;
      continue;
    }

    if (pomijaneZnaki.has(call.toUpperCase())) {
      const k = oczekujace.get(call);
      if (k && k.length) k.shift();
      pominieteZnaki += 1;
      continue;
    }

    const kolejka = oczekujace.get(call);
    const zrodlo = kolejka && kolejka.length ? kolejka.shift() : null;
    if (!zrodlo) {
      // „zapisane" bez pary bywa na starcie pliku, gdy log jest ucięty albo
      // QSO trafiło do kolejki w poprzedniej sesji. Znaku stacji nie zgadujemy.
      bezPary += 1;
      continue;
    }

    // Data i godzina z wpisu „Nowe QSO”, nie z potwierdzenia: wszystkie kopie
    // jednego QSO mają wtedy tę samą minutę, więc liczy się jako JEDNO QSO,
    // a nie trzy. Potwierdzenia przychodzą sekundę po sekundzie.
    const d = new Date(zrodlo.ts);
    const rec = {
      at: new Date(ts).toISOString(),
      date: d.toISOString().slice(0, 10),
      time: normalizeTime(d.toISOString().slice(11, 16).replace(':', '')),
      call, station: zrodlo.station, operator: zrodlo.operator,
      actions: Array.isArray(extra.akcje) ? extra.akcje.map(String) : [],
      band: zrodlo.band, mode: zrodlo.mode,
      source: extra.source || zrodlo.source || null,
      imported: true,
    };

    const k = kluczKopii(rec);
    if (widziane.has(k)) { duplikaty += 1; continue; }
    widziane.add(k);
    doZapisu.push(rec);
  }

  const zostalo = [...oczekujace.values()].reduce((n, a) => n + a.length, 0);
  if (zostalo) {
    console.log(`  ${plik}: ${zostalo} wpisów „Nowe QSO" bez potwierdzenia `
      + '(QSO odrzucone, w kolejce albo log ucięty) — pomijam');
  }
}

console.log('');
console.log(`Przeczytane linie      : ${linii}`);
console.log(`„Nowe QSO"             : ${nowe}`);
console.log(`„zapisane"             : ${zapisane}`);
console.log(`przejścia próbne       : ${probne} (pominięte — nie były wysłane)`);
if (pomijaneZnaki.size) {
  console.log(`pominięte znaki        : ${pominieteZnaki} (${[...pomijaneZnaki].join(', ')})`);
}
console.log(`bez pary               : ${bezPary}`);
console.log(`już w dzienniku        : ${duplikaty}`);
console.log(`do zapisu              : ${doZapisu.length}`);

if (doZapisu.length) {
  const daty = doZapisu.map((r) => r.date).sort();
  console.log(`zakres dat             : ${daty[0]} … ${daty[daty.length - 1]}`);
}

if (dry) {
  console.log('\n--dry: nic nie zapisałam. Przykładowe wpisy:');
  for (const r of doZapisu.slice(0, 3)) console.log('  ' + JSON.stringify(r));
  process.exit(0);
}

// Zapis w kolejności chronologicznej — dziennik czyta się wtedy naturalnie.
doZapisu.sort((a, b) => a.at.localeCompare(b.at));
let ok = 0;
for (const r of doZapisu) if (journal.append(r)) ok += 1;
console.log(`\nZapisane: ${ok} z ${doZapisu.length} → ${journalDir}`);
if (ok < doZapisu.length) console.error('UWAGA: nie wszystko się zapisało, sprawdź uprawnienia do katalogu.');
