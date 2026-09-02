// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Blokady oparte na pliku z PID-em. Używane w dwóch miejscach:
//  - katalog danych (żeby dwa mostki nie opróżniały jednej kolejki),
//  - port UDP (żeby dwa mostki nie dzieliły między siebie datagramów).
//
// Ta druga jest nieoczywista, a ważniejsza: gniazda UDP z SO_REUSEADDR
// pozwalają dwóm procesom zająć ten sam port, a datagramy trafiają wtedy
// do jednego z nich w sposób nieprzewidywalny — QSO przepadałyby po cichu.
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { log } from './log.js';

/** Czy proces o danym PID żyje (działa też na Windows). */
export function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

/**
 * Zajmuje blokadę. Blokadę po nieżyjącym procesie przejmujemy (np. po twardym
 * ubiciu albo restarcie maszyny).
 * @param {string} file  ścieżka pliku blokady
 * @param {string} what  opis do komunikatu błędu
 * @param {string} hint  podpowiedź, co zrobić
 * @throws gdy blokadę trzyma żywy proces
 */
export function acquireLock(file, what, hint) {
  mkdirSync(dirname(file), { recursive: true });

  if (existsSync(file)) {
    let pid = null;
    try { pid = Number(JSON.parse(readFileSync(file, 'utf8')).pid); } catch { /* uszkodzona */ }
    if (pid && pid !== process.pid && isAlive(pid)) {
      throw new Error(`${what} jest już używany przez proces ${pid} (${file}). ${hint}`);
    }
    if (pid) log.warn(`Przejmuję osieroconą blokadę: ${what}`, { pid });
  }

  writeFileSync(file, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
}

/** Zwalnia blokadę, ale tylko jeśli należy do nas. */
export function releaseLock(file) {
  if (!file) return;
  try {
    if (JSON.parse(readFileSync(file, 'utf8')).pid === process.pid) unlinkSync(file);
  } catch { /* już zwolniona albo nie nasza */ }
}

/**
 * Plik blokady portu UDP. Leży w katalogu tymczasowym systemu, a NIE w katalogu
 * danych — inaczej dwie instancje z różnymi dataDir wciąż walczyłyby o port.
 */
export function udpLockPath(host, port) {
  return join(tmpdir(), `radiodyplom-bridge-udp-${host.replace(/[^\w.]/g, '_')}-${port}.lock`);
}
