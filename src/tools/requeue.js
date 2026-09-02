#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Przywraca elementy z data/failed/ do kolejki: npm run requeue
// Pomija te, które serwer odrzucił trwale (są już w seen).
import { loadConfig } from '../config.js';
import { Store } from '../store.js';
import { requeueFailed } from '../requeue.js';

const cfg = loadConfig();
const store = new Store(cfg.queue);
store.init();

const { restored, skipped, calls } = requeueFailed(store);

for (const c of calls) console.log(`Przywrócono ${c}`);
console.log(`\nPrzywrócone: ${restored}, pominięte: ${skipped}`);
