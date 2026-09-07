// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Sekrety podawane przez środowisko (plik pin.env na maszynie bez pulpitu).
//
// Sedno: `config.json` ma prawa 0644 i bywa wklejany do zgłoszeń błędów, więc
// PIN i hasz hasła mieszkają osobno, w pin.env z prawami 0640. Testy pilnują,
// że ta ostrożność nie jest pozorna — czyli że zapis konfiguracji z okna NIE
// przepisuje ich do pliku. Sprawdzone 2026-09-07: PIN faktycznie wyciekał.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setLevel } from '../src/log.js';

setLevel('error');

const HASZ = 'scrypt$'.concat('a'.repeat(32), '$', 'b'.repeat(64));
let dir;

/** Konfiguracja na dysku BEZ sekretów — tak wygląda plik na malince. */
function zasiej(api = {}) {
  writeFileSync(join(dir, 'config.json'), JSON.stringify({
    udp: { host: '127.0.0.1', port: 12060, multicastGroups: [] },
    dataDir: dir,
    radiodyplom: { apiUrl: 'http://x/y', pin: '', timeoutMs: 1000, dryRun: true },
    forward: { operations: ['insert'], targets: [] },
    queue: { dir: './q', failedDir: './f', seenFile: './s.json' },
    rateLimit: { maxPerMinute: 9, minSpacingMs: 700 },
    api: { enabled: false, port: 12061, ...api },
    logLevel: 'error',
  }, null, 2));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rd-env-'));
  process.env.RD_CONFIG_DIR = dir;
});

afterEach(() => {
  delete process.env.RD_CONFIG_DIR;
  delete process.env.RD_PIN;
  delete process.env.RD_API_PASSWORD_HASH;
  rmSync(dir, { recursive: true, force: true });
});

const swiezy = async () => {
  const cfgMod = await import(`../src/config.js?${Math.random()}`);
  const edit = await import(`../src/configedit.js?${Math.random()}`);
  return { cfgMod, edit };
};

describe('hasło do interfejsu z pin.env', () => {
  test('RD_API_PASSWORD_HASH wchodzi do konfiguracji', async () => {
    zasiej();
    process.env.RD_API_PASSWORD_HASH = HASZ;
    const { cfgMod } = await swiezy();
    const cfg = cfgMod.loadConfig();
    assert.equal(cfg.api.auth.passwordHash, HASZ);
    assert.equal(cfg._zEnv.apiPasswordHash, true);
  });

  test('wartość ze środowiska WYGRYWA z tą z pliku', async () => {
    // Inaczej stary hasz w config.json cicho unieważniałby nowe hasło z pin.env.
    zasiej({ auth: { passwordHash: 'scrypt$stary$stary' } });
    process.env.RD_API_PASSWORD_HASH = HASZ;
    const { cfgMod } = await swiezy();
    assert.equal(cfgMod.loadConfig().api.auth.passwordHash, HASZ);
  });

  test('bez zmiennej nic się nie zmienia', async () => {
    zasiej({ auth: { passwordHash: HASZ } });
    const { cfgMod } = await swiezy();
    const cfg = cfgMod.loadConfig();
    assert.equal(cfg.api.auth.passwordHash, HASZ);
    assert.equal(cfg._zEnv.apiPasswordHash, undefined);
  });
});

describe('sekrety ze środowiska NIE wracają do config.json', () => {
  test('PIN z RD_PIN nie trafia do pliku przy zapisie', async () => {
    // REGRES SPRAWDZONY DOŚWIADCZALNIE 2026-09-07: przed poprawką pierwszy
    // zapis konfiguracji z okna przepisywał PIN z pin.env do config.json,
    // czyli do pliku o prawach 0644.
    zasiej();
    process.env.RD_PIN = 'SEKRET-PIN-1234';
    const { cfgMod, edit } = await swiezy();
    const cfg = cfgMod.loadConfig();
    assert.equal(cfg.radiodyplom.pin, 'SEKRET-PIN-1234', 'najpierw ma działać');

    edit.writeConfigFile(cfg);
    const naDysku = readFileSync(join(dir, 'config.json'), 'utf8');
    assert.equal(naDysku.includes('SEKRET-PIN-1234'), false, 'PIN wyciekł do pliku');
    assert.equal(JSON.parse(naDysku).radiodyplom.pin, '', 'zostaje to, co było w pliku');
  });

  test('hasz z RD_API_PASSWORD_HASH nie trafia do pliku przy zapisie', async () => {
    zasiej();
    process.env.RD_API_PASSWORD_HASH = HASZ;
    const { cfgMod, edit } = await swiezy();
    const cfg = cfgMod.loadConfig();
    edit.writeConfigFile(cfg);
    const naDysku = readFileSync(join(dir, 'config.json'), 'utf8');
    assert.equal(naDysku.includes(HASZ), false, 'hasz wyciekł do pliku');
    assert.equal(JSON.parse(naDysku).api.auth?.passwordHash, undefined);
  });

  test('hasz Z PLIKU zostaje w pliku (nie gubimy cudzej konfiguracji)', async () => {
    // Odwrotny błąd byłby równie zły: gdyby ochrona kasowała hasz ustawiony
    // normalnie, zapis z okna zdejmowałby hasło.
    zasiej({ auth: { passwordHash: HASZ } });
    const { cfgMod, edit } = await swiezy();
    const cfg = cfgMod.loadConfig();
    edit.writeConfigFile(cfg);
    assert.equal(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))
      .api.auth.passwordHash, HASZ);
  });
});

describe('interfejs wie, że sekret pochodzi ze środowiska', () => {
  test('editableConfig oznacza oba przypadki', async () => {
    zasiej();
    process.env.RD_PIN = 'SEKRET';
    process.env.RD_API_PASSWORD_HASH = HASZ;
    const { cfgMod, edit } = await swiezy();
    const w = edit.editableConfig(cfgMod.loadConfig());
    assert.equal(w.radiodyplom.pinFromEnv, true);
    assert.equal(w.api.auth.passwordFromEnv, true);
    // I nadal żadnego sekretu w tym, co dostaje okno.
    const tekst = JSON.stringify(w);
    assert.equal(tekst.includes('SEKRET'), false);
    assert.equal(tekst.includes(HASZ), false);
  });

  test('zmiana hasła z okna jest pomijana, gdy pochodzi ze środowiska', async () => {
    // Zadziałałaby do najbliższego restartu i zniknęła — gorzej niż odmowa.
    zasiej();
    process.env.RD_API_PASSWORD_HASH = HASZ;
    const { cfgMod, edit } = await swiezy();
    const cfg = cfgMod.loadConfig();
    const daemon = { cfg, client: {}, listener: {}, worker: {} };
    edit.applyConfig(daemon, { api: { auth: { password: 'zupelnie-inne-haslo' } } });
    assert.equal(cfg.api.auth.passwordHash, HASZ, 'hasz ma zostać nietknięty');
  });
});
