#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Sprawdza PIN/klucz API radiodyplom: npm run ping
import { loadConfig } from '../config.js';
import { RadiodyplomClient } from '../radiodyplom.js';

const cfg = loadConfig();
const client = new RadiodyplomClient({ ...cfg.radiodyplom, dryRun: false });
const res = await client.ping();

if (res.ok) {
  console.log(`OK – klucz działa. Operator: ${res.operator}`);
  process.exit(0);
} else {
  console.error(`BŁĄD – ${res.error}`);
  process.exit(1);
}
