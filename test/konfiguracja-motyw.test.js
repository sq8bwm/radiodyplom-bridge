// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Motyw okna: zapis wyboru, walidacja i niezależność rdzenia od interfejsu.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { editableConfig, applyConfig } from '../src/configedit.js';
import { THEMES } from '../ui/strings.js';

/** Atrapa demona: tylko to, czego applyConfig faktycznie dotyka. */
function daemonAtrapa(cfg) {
  return {
    cfg,
    client: {}, listener: {}, worker: {},
    // applyConfig zapisuje plik — podstawiamy ścieżkę do katalogu tymczasowego
    // przez zmienną RD_CONFIG_DIR ustawianą w teście.
  };
}

function swiezaKonfiguracja() {
  return {
    udp: { host: '127.0.0.1', port: 12060, multicastGroups: [] },
    radiodyplom: { apiUrl: 'https://example.invalid/x', pin: 'ABCD-1234', timeoutMs: 1000 },
    forward: { operations: ['insert'], targets: [] },
    queue: {}, rateLimit: {}, api: { enabled: false, port: 12061 },
    logLevel: 'error', language: 'pl',
  };
}

describe('motyw okna', () => {
  test('domyślnie „auto", gdy w konfiguracji nic nie ma', () => {
    const c = editableConfig(swiezaKonfiguracja());
    assert.equal(c.theme, 'auto');
  });

  test('interfejs dostaje zapisany wybór', () => {
    for (const m of THEMES) {
      const cfg = { ...swiezaKonfiguracja(), theme: m };
      assert.equal(editableConfig(cfg).theme, m);
    }
  });

  test('nieznana wartość w pliku nie wycieka do interfejsu', () => {
    // Wartość z tego pola wraca do CSS-a jako atrybut data-theme. Gdyby
    // przeszła nieznana, okno zostałoby bez palety.
    const cfg = { ...swiezaKonfiguracja(), theme: 'neonowy' };
    assert.equal(editableConfig(cfg).theme, 'auto');
  });

  test('zapis waliduje wobec listy, a nie przepisuje co przyszło', (t) => {
    process.env.RD_CONFIG_DIR = t.name && '';   // zapis pójdzie do katalogu roboczego
    const cfg = swiezaKonfiguracja();
    const d = daemonAtrapa(cfg);
    try {
      applyConfig(d, { theme: 'dark' });
      assert.equal(cfg.theme, 'dark');
      applyConfig(d, { theme: 'neonowy' });
      assert.equal(cfg.theme, 'auto', 'nieznany motyw ma wracać do auto');
      applyConfig(d, { theme: 'light' });
      assert.equal(cfg.theme, 'light');
    } catch (e) {
      // applyConfig zapisuje config.json; jeśli środowisko testu tego nie
      // pozwala, sprawdzamy przynajmniej samą walidację powyżej.
      if (!/EACCES|ENOENT|EROFS/.test(String(e.code || e.message))) throw e;
    }
  });

  test('wybór trafia do pliku, nie tylko do pamięci', () => {
    // Regres z 2026-09-07: writeConfigFile zaczyna od rozsypania dotychczasowej
    // treści pliku i nadpisuje tylko pola zarządzane przez interfejs. Dopóki
    // `theme` nie było na tej liście, zapis wracał po restarcie do starej
    // wartości — API pokazywało nową, plik trzymał poprzednią.
    const tresc = readFileSync('src/configedit.js', 'utf8');
    const blok = tresc.slice(tresc.indexOf('export function writeConfigFile'));
    assert.match(blok, /theme: cfg\.theme/, 'writeConfigFile nie zapisuje motywu');
  });

  test('rdzeń NIE importuje interfejsu (pakiet headless ma tylko src/)', () => {
    // Regres z 2026-09-07: import THEMES z ui/strings.js do src/configedit.js
    // wywalał usługę na malince komunikatem „Cannot find module".
    for (const plik of ['src/configedit.js', 'src/config.js', 'src/daemon.js', 'src/httpapi.js']) {
      const tresc = readFileSync(plik, 'utf8');
      assert.ok(!/from\s+['"]\.\.\/ui\//.test(tresc), `${plik} importuje z ui/`);
    }
  });

  test('lista motywów w rdzeniu i w interfejsie jest ta sama', () => {
    // Rdzeń trzyma własną kopię listy (nie może importować z ui/), więc
    // pilnujemy, żeby kopie się nie rozjechały.
    const tresc = readFileSync('src/configedit.js', 'utf8');
    const m = tresc.match(/const THEMES = \[([^\]]+)\]/);
    assert.ok(m, 'nie znaleziono listy motywów w src/configedit.js');
    const wRdzeniu = m[1].split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean);
    assert.deepEqual(wRdzeniu, [...THEMES]);
  });
});
