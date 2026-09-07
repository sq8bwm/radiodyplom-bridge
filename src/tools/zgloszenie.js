// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Zapisuje konfigurację i stan do pliku nadającego się do wysłania.
//
// Dla maszyny bez pulpitu: `node src/tools/zgloszenie.js [katalog]`.
// W wersji z okienkiem to samo robi pozycja w menu zasobnika.
import { loadConfig } from '../config.js';
import { buildReport, saveReport } from '../report.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setLevel } from '../log.js';

setLevel('error');   // narzędzie ma wypisać ścieżkę, nie zalewać logiem

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const katalog = process.argv[2] || process.cwd();
const cfg = loadConfig();
const plik = saveReport(katalog, buildReport({ cfg, pkg }));

console.log(`Zapisano zgłoszenie: ${plik}`);
console.log('');
console.log('PIN-y są zamaskowane, hasła nie ma wcale. Ten plik możesz wysłać.');
console.log('NIE wysyłaj config.json — tam PIN jest jawny.');
