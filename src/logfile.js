// Zapis logu do pliku, z rotacją.
//
// Po co: log żył wyłącznie w pamięci (bufor 300 wpisów) i ginął przy zamknięciu.
// Gdy 2026-08-31 zniknęły dwa QSO, diagnoza była możliwa tylko dlatego, że
// operator zdążył ręcznie skopiować konsolę. Tego nie można wymagać.
//
// Świadomie prosto: jeden plik bieżący plus kilka poprzednich, bez zależności.
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

let enabled = false;
let filePath = null;
let maxBytes = 5 * 1024 * 1024;
let keep = 3;
let written = 0;

/** Przesuwa log.3 → usuń, log.2 → log.3, log → log.1. */
function rotate() {
  try {
    const oldest = `${filePath}.${keep}`;
    if (existsSync(oldest)) unlinkSync(oldest);
    for (let i = keep - 1; i >= 1; i--) {
      const from = `${filePath}.${i}`;
      if (existsSync(from)) renameSync(from, `${filePath}.${i + 1}`);
    }
    if (existsSync(filePath)) renameSync(filePath, `${filePath}.1`);
  } catch { /* rotacja best-effort: gorszy log to wciąż lepsze niż brak logu */ }
  written = 0;
}

/**
 * Włącza zapis do pliku.
 * @param {{dir:string, name?:string, maxBytes?:number, keep?:number}} opts
 * @returns {string} ścieżka pliku
 */
export function enableFileLog(opts) {
  filePath = join(opts.dir, opts.name || 'bridge.log');
  if (opts.maxBytes) maxBytes = opts.maxBytes;
  if (opts.keep) keep = opts.keep;
  mkdirSync(opts.dir, { recursive: true });
  written = existsSync(filePath) ? statSync(filePath).size : 0;
  enabled = true;
  return filePath;
}

export function logFilePath() {
  return filePath;
}

/**
 * Dopisuje linię. Zapis SYNCHRONICZNY i to jest świadome: przy strumieniu
 * asynchronicznym ostatnie linie (te najciekawsze przy awarii) ginęły razem
 * z buforem przy wyjściu z procesu. Log ma kilka linii na QSO, więc koszt
 * jest bez znaczenia, a gwarancja zapisu — kluczowa.
 */
export function appendLine(line) {
  if (!enabled) return;
  const buf = `${line}\n`;
  try {
    appendFileSync(filePath, buf);
    written += Buffer.byteLength(buf);
    if (written >= maxBytes) rotate();
  } catch { /* awaria zapisu logu nie może wywrócić mostka */ }
}

export function closeFileLog() {
  enabled = false;
}
