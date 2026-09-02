#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Tryb headless: logger (UDP) → kolejka → radiodyplom.pl
// Cała logika siedzi w daemon.js; tutaj tylko uruchomienie i obsługa sygnałów.
import { loadConfig } from './config.js';
import { log } from './log.js';
import { startDaemon } from './daemon.js';
import { closeFileLog } from './logfile.js';

async function main() {
  const cfg = loadConfig();
  log.info('Start radiodyplom-bridge', { config: cfg._source });

  // W trybie headless nie ma gdzie wpisać PIN-u, więc jego brak jest błędem.
  // (W trybie z UI aplikacja wstaje i PIN podaje się w zakładce Konfiguracja.)
  if (cfg._pinMissing) {
    throw new Error('Brak PIN-u radiodyplom. Ustaw radiodyplom.pin w config.json albo zmienną RD_PIN.');
  }

  const daemon = await startDaemon(cfg);

  const shutdown = (sig) => {
    log.info(`Sygnał ${sig} – zamykam`);
    daemon.stop();
    log.info('Statystyki UDP', daemon.listener.stats);
    closeFileLog();          // dopiero po ostatniej linii
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  // Windows: Ctrl+Break oraz zamknięcie konsoli
  if (process.platform === 'win32') process.on('SIGBREAK', () => shutdown('SIGBREAK'));

  log.info('Gotowe. Czekam na QSO z loggera.');
}

main().catch((err) => {
  log.error('Krytyczny błąd startu', err.message);
  process.exit(1);
});
