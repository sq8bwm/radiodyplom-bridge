// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Zgłoszenie do wysłania: to, co wolno pokazać obcemu.
//
// Sedno: config.json w wersji z pulpitem zawiera JAWNY PIN i jest pierwszą
// rzeczą, którą człowiek wysyła, gdy coś nie działa. Ten plik ma być tym, co
// wysyła zamiast — więc test pilnuje przede wszystkim, czego w nim NIE MA.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildReport, saveReport, zaslon, sekretyDoUsuniecia, ZASLONA } from '../src/report.js';
import { setLevel } from '../src/log.js';

setLevel('error');

const PIN = 'TZV7-SEKRET-9';
const PIN_CELU = 'BZQ4-DRUGI-77';
const HASZ = 'scrypt$'.concat('a'.repeat(32), '$', 'b'.repeat(64));

const cfg = () => ({
  udp: { host: '127.0.0.1', port: 12060, multicastGroups: [] },
  radiodyplom: { apiUrl: 'https://x/y', pin: PIN, timeoutMs: 1000, dryRun: false },
  forward: { operations: ['insert'], targets: [
    { station_callsign: 'SN8N', operator: 'SQ8BWA', enabled: true },
    { station_callsign: 'SP9XYZ', pin: PIN_CELU, enabled: false },
  ] },
  queue: { maxAttempts: 20, seenFile: '/nie/ma/takiego/seen.json' },
  rateLimit: { maxPerMinute: 9 },
  api: { enabled: true, port: 12061, host: '127.0.0.1',
    auth: { passwordHash: HASZ }, tls: { enabled: true } },
  logLevel: 'error', ui: { recentEvents: 20 },
});

describe('sekrety nie mogą wyjść', () => {
  test('żaden sekret nie trafia do zgłoszenia', () => {
    const r = JSON.stringify(buildReport({ cfg: cfg(), pkg: { version: '9.9.9' } }));
    for (const [nazwa, sek] of [['PIN', PIN], ['PIN celu', PIN_CELU], ['hasz', HASZ]]) {
      assert.equal(r.includes(sek), false, `${nazwa} wyciekł do zgłoszenia`);
    }
  });

  test('PIN-y są za to widoczne jako maski — inaczej nie da się pomóc', () => {
    const r = buildReport({ cfg: cfg(), pkg: {} });
    assert.match(r.konfiguracja.radiodyplom.pin, /^TZ\*\*-\*\*\*\*$/);
    assert.equal(r.konfiguracja.api.auth.passwordHash, undefined);
    assert.equal(r.konfiguracja.api.auth.passwordSet, true);
  });

  test('sekret w LOGU nie wychodzi ze zgłoszenia', () => {
    // Ten test przechodzi przez buildReport, a nie przez samą funkcję
    // zasłaniającą — inaczej nie zauważyłby, że warstwa druga została
    // z buildReport wyjęta. Pierwsza wersja tego testu tego nie łapała
    // (mutacja przechodziła), więc jest przepisana.
    const dir = mkdtempSync(join(tmpdir(), 'rd-log-'));
    try {
      writeFileSync(join(dir, 'bridge.log'),
        `2026-09-07T10:00:00Z [INFO] wysylka PIN-em ${PIN} do celu\n`
        + `2026-09-07T10:00:01Z [INFO] hasz ${HASZ} w logu\n`);
      const k = cfg();
      k.queue.seenFile = join(dir, 'seen.json');   // stąd bierze się katalog logu
      const r = buildReport({ cfg: k, pkg: {} });
      assert.ok(r.log.length >= 2, 'log ma być wczytany z pliku');
      const t = JSON.stringify(r);
      assert.equal(t.includes(PIN), false, 'PIN z logu wyciekł do zgłoszenia');
      assert.equal(t.includes(HASZ), false, 'hasz z logu wyciekł do zgłoszenia');
      assert.ok(t.includes(ZASLONA), 'sekret ma być zasłonięty, nie usunięty w ciszy');
      assert.match(r.log[0], /wysylka PIN-em/, 'reszta wpisu zostaje czytelna');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('druga warstwa łapie sekret wpuszczony obok maskowania', () => {
    // Warstwa pierwsza (editableConfig) opiera się na tym, że wszystkie
    // ścieżki są poprawne. Ta sprawdza, że nawet gdy któraś przestanie być —
    // na przykład sekret trafi do logu — wynik i tak go nie wypuści.
    const brudne = { log: [`[INFO] ktos zalogowal sie PIN-em ${PIN}`], glebiej: { x: [HASZ] } };
    const czyste = zaslon(brudne, sekretyDoUsuniecia(cfg()));
    const t = JSON.stringify(czyste);
    assert.equal(t.includes(PIN), false);
    assert.equal(t.includes(HASZ), false);
    assert.ok(t.includes(ZASLONA));
    assert.match(czyste.log[0], /ktos zalogowal sie PIN-em/, 'reszta wpisu zostaje czytelna');
  });

  test('krótkie wartości nie są maskowane (zjadłyby tekst)', () => {
    // Podmiana trzyznakowej wartości wycięłaby fragmenty słów i zrobiła
    // zgłoszenie nieczytelnym, a sekretem taka wartość nie jest.
    const k = cfg(); k.radiodyplom.pin = 'abc';
    assert.deepEqual(sekretyDoUsuniecia(k).filter((x) => x === 'abc'), []);
  });
});

describe('zgłoszenie zawiera to, co potrzebne do pomocy', () => {
  test('wersja, system i stan', () => {
    const r = buildReport({ cfg: cfg(), pkg: { name: 'x', version: '1.2.3' } });
    assert.equal(r.zgloszenie.wersja, '1.2.3');
    assert.match(r.zgloszenie.system, /\w+ \w+/);
    assert.ok(r.zgloszenie.node);
    assert.ok('konfiguracja' in r && 'log' in r && 'stan' in r);
  });

  test('stan z API jest przepisywany, gdy jest dostępny', () => {
    const status = {
      version: '1.2.3',
      queue: { pending: 3, failed: 1 },
      listener: { host: '127.0.0.1', port: 12060 },
      api: { host: '0.0.0.0', port: 12061, siec: true, tylkoOdczyt: true },
      radiodyplom: { profile: 'SQ8BWM', pingOk: true, dryRun: false },
      forward: { targets: [{ station_callsign: 'SN8N', enabled: true, check: { state: 'ok' } }] },
      problems: { count: 0 }, update: null,
    };
    const r = buildReport({ cfg: cfg(), status, pkg: {} });
    assert.equal(r.stan.kolejka.pending, 3);
    assert.equal(r.stan.api.siec, true);
    assert.equal(r.stan.cele[0].state, 'ok');
    assert.equal(r.stan.radiodyplom.profil, 'SQ8BWM');
  });

  test('brak statusu nie wywala zgłoszenia', () => {
    // Demon może nie wstać — a wtedy zgłoszenie jest najbardziej potrzebne.
    const r = buildReport({ cfg: cfg(), status: null, pkg: {} });
    assert.equal(r.stan, null);
    assert.ok(r.konfiguracja);
  });
});

describe('plik zgłoszenia', () => {
  test('zapisany z prawami 0600', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rd-zgl-'));
    try {
      const plik = saveReport(dir, buildReport({ cfg: cfg(), pkg: {} }));
      assert.match(plik, /radiodyplom-zgloszenie-.*\.json$/);
      // Plik nie ma sekretów, ale ma log ze znakami korespondentów i nazwą
      // maszyny — nie ma powodu, żeby leżał otwarty.
      assert.equal(statSync(plik).mode & 0o777, 0o600);
      const wczytane = JSON.parse(readFileSync(plik, 'utf8'));
      assert.ok(wczytane.zgloszenie.utworzono);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
