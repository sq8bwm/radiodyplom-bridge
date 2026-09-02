// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Prosty logger z poziomami; jedna linia = jedno zdarzenie.
// Zdarzenia trafiają do: konsoli, bufora w pamięci (podgląd w UI) i — jeśli
// włączony — do pliku (logfile.js). Plik jest jedynym śladem, który przeżywa
// zamknięcie programu, więc bez niego diagnoza po fakcie jest niemożliwa.
import { appendLine } from './logfile.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold = LEVELS.info;

// Pierścieniowy bufor ostatnich zdarzeń – źródło dla podglądu logu w UI.
const RING = [];
const RING_MAX = 300;

/** @returns {Array} ostatnie n zdarzeń, najstarsze pierwsze */
export function recentLog(n = 50) {
  return RING.slice(-Math.max(1, Math.min(n, RING_MAX)));
}

export function setLevel(name) {
  if (LEVELS[name] != null) threshold = LEVELS[name];
}

function emit(level, msg, extra) {
  if (LEVELS[level] < threshold) return;
  const ts = new Date().toISOString();

  RING.push({ ts, level, msg, extra: extra === undefined ? undefined : safe(extra) });
  if (RING.length > RING_MAX) RING.shift();

  const tail = extra !== undefined ? ' ' + safe(extra) : '';
  const line = `${ts} [${level.toUpperCase()}] ${msg}${tail}`;
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
  appendLine(line);
}

function safe(v) {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

export const log = {
  debug: (m, e) => emit('debug', m, e),
  info: (m, e) => emit('info', m, e),
  warn: (m, e) => emit('warn', m, e),
  error: (m, e) => emit('error', m, e),
};
