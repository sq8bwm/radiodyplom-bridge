#!/usr/bin/env node
// Podgląd stanu kolejki i błędów: npm run queue
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../config.js';

const cfg = loadConfig();

function read(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { return null; }
    })
    .filter(Boolean);
}

const pending = read(cfg.queue.dir);
const failed = read(cfg.queue.failedDir);
const seen = existsSync(cfg.queue.seenFile)
  ? JSON.parse(readFileSync(cfg.queue.seenFile, 'utf8')).length
  : 0;

console.log(`Wysłane (seen): ${seen}`);
console.log(`W kolejce:      ${pending.length}`);
console.log(`Trwałe błędy:   ${failed.length}`);

if (pending.length) {
  console.log('\n-- oczekujące --');
  for (const i of pending) {
    const due = i.nextAt ? new Date(i.nextAt).toISOString() : 'teraz';
    console.log(`  ${i.payload.callsign.padEnd(10)} próby=${i.attempts} następna=${due} ${i.lastError ? '| ' + i.lastError : ''}`);
  }
}

if (failed.length) {
  console.log('\n-- odrzucone --');
  for (const i of failed) {
    console.log(`  ${i.payload.callsign.padEnd(10)} próby=${i.attempts} | ${i.lastError}`);
  }
}
