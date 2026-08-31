#!/usr/bin/env node
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
