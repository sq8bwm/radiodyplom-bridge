// Edycja konfiguracji z interfejsu. Dwa dzisiejsze błędy mieszkały tutaj:
// gubienie PIN-ów przy zapisie i fałszywe „wymaga restartu".
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setLevel } from '../src/log.js';

setLevel('error');

let dir;
let mod;          // configedit z ustawionym RD_CONFIG_DIR
let cfgMod;       // config.js

const BASE = () => ({
  udp: { host: '127.0.0.1', port: 12060, multicastGroups: [] },
  radiodyplom: {
    apiUrl: 'https://x/api', pin: 'AAAA-1111', timeoutMs: 1000, dryRun: true,
    pingIntervalMs: 30000,
  },
  operators: [{ call: 'SQ8BWM', name: 'Marek', pin: 'CCCC-3333' }],
  forward: {
    operations: ['insert'],
    targets: [{ station_callsign: 'SQ8BWA', operator: 'SQ8BWA', pin: 'BBBB-2222' }],
  },
  queue: { dir: './data/queue', failedDir: './data/failed', seenFile: './data/seen.json', maxAttempts: 20, baseDelayMs: 5000, maxDelayMs: 900000 },
  rateLimit: { maxPerMinute: 9, minSpacingMs: 700 },
  api: { enabled: true, port: 12061 },
  logLevel: 'info',
  language: 'pl',
  logFile: { enabled: true, maxBytes: 1024, keep: 2 },
});

/** Atrapa uchwytu daemona — applyConfig stosuje zmiany „na żywo" na tych obiektach. */
function fakeDaemon(cfg) {
  return {
    cfg,
    client: {}, listener: {}, worker: {},
    pendingRestart: new Set(),
  };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'rdb-cfg-'));
  writeFileSync(join(dir, 'config.json'), JSON.stringify(BASE(), null, 2));
  process.env.RD_CONFIG_DIR = dir;
  const stamp = `${Date.now()}${Math.random()}`;
  cfgMod = await import(`../src/config.js?t=${stamp}`);
  mod = await import(`../src/configedit.js?t=${stamp}`);
});

afterEach(() => {
  delete process.env.RD_CONFIG_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const saved = () => JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));

describe('editableConfig — co widzi interfejs', () => {
  test('PIN-y są zamaskowane, nigdy jawne', () => {
    const view = mod.editableConfig(cfgMod.loadConfig());
    assert.equal(view.radiodyplom.pin, 'AAAA-****');
    assert.equal(view.forward.targets[0].pin, 'BBBB-****');
    assert.equal(JSON.stringify(view).includes('1111'), false);
    assert.equal(JSON.stringify(view).includes('2222'), false);
  });

  test('pinSet mówi, czy PIN jest ustawiony, bez ujawniania go', () => {
    const view = mod.editableConfig(cfgMod.loadConfig());
    assert.equal(view.radiodyplom.pinSet, true);
    assert.equal(view.forward.targets[0].pinSet, true);
  });
});

describe('applyConfig — zapis z interfejsu', () => {
  // REGRESJA: interfejs odsyła PIN-y w postaci zamaskowanej. Potraktowanie
  // maski jako nowej wartości zniszczyłoby prawdziwe PIN-y przy każdym zapisie.
  test('zamaskowany PIN znaczy „nie zmieniaj"', () => {
    const cfg = cfgMod.loadConfig();
    mod.applyConfig(fakeDaemon(cfg), {
      radiodyplom: { pin: 'AAAA-****', dryRun: false },
      forward: { targets: [{ station_callsign: 'SQ8BWA', operator: 'SQ8BWA', pin: 'BBBB-****' }] },
    });
    assert.equal(saved().radiodyplom.pin, 'AAAA-1111', 'PIN główny zachowany');
    assert.equal(saved().forward.targets[0].pin, 'BBBB-2222', 'PIN celu zachowany');
    assert.equal(saved().radiodyplom.dryRun, false, 'a zmiana obok weszła');
  });

  test('pusty PIN też znaczy „nie zmieniaj"', () => {
    const cfg = cfgMod.loadConfig();
    mod.applyConfig(fakeDaemon(cfg), { radiodyplom: { pin: '' } });
    assert.equal(saved().radiodyplom.pin, 'AAAA-1111');
  });

  test('nowy PIN podmienia stary', () => {
    const cfg = cfgMod.loadConfig();
    mod.applyConfig(fakeDaemon(cfg), { radiodyplom: { pin: 'NOWY-1234' } });
    assert.equal(saved().radiodyplom.pin, 'NOWY-1234');
  });

  // REGRESJA: brak klucza i pusta lista były porównywane jako różne wartości,
  // więc zapis BEZ ZMIAN kazał restartować. Ostrzeżenia, które kłamią,
  // przestają być czytane.
  test('zapis bez zmian nie żąda restartu', () => {
    const cfg = cfgMod.loadConfig();
    const r = mod.applyConfig(fakeDaemon(cfg), {
      udp: { host: '127.0.0.1', port: 12060, multicastGroups: [] },
    });
    assert.deepEqual(r.restartRequired, []);
    assert.deepEqual(r.pendingRestart, []);
  });

  test('zmiana portu żąda restartu i jest pamiętana', () => {
    const cfg = cfgMod.loadConfig();
    const d = fakeDaemon(cfg);
    const r = mod.applyConfig(d, { udp: { host: '127.0.0.1', port: 12070 } });
    assert.deepEqual(r.restartRequired, ['udp.port']);
    assert.deepEqual(r.pendingRestart, ['udp.port']);
    // kolejny zapis czegoś innego nie gubi wcześniejszej potrzeby restartu
    const r2 = mod.applyConfig(d, { radiodyplom: { dryRun: true } });
    assert.deepEqual(r2.restartRequired, []);
    assert.deepEqual(r2.pendingRestart, ['udp.port'], 'stan trwały');
  });

  test('PIN, tryb próbny i cele działają od razu (bez restartu)', () => {
    const cfg = cfgMod.loadConfig();
    const r = mod.applyConfig(fakeDaemon(cfg), {
      radiodyplom: { pin: 'NOWY-1234', dryRun: false },
      forward: { targets: [{ station_callsign: 'SP1AAA' }] },
    });
    assert.deepEqual(r.restartRequired, []);
  });

  test('zmiany są stosowane na żywo na obiektach rdzenia', () => {
    const cfg = cfgMod.loadConfig();
    const d = fakeDaemon(cfg);
    mod.applyConfig(d, { radiodyplom: { pin: 'NOWY-1234', dryRun: false } });
    assert.equal(d.client.pin, 'NOWY-1234');
    assert.equal(d.client.dryRun, false);
    assert.equal(d.listener.pin, 'NOWY-1234');
  });

  test('znaki stacji i operatorów są normalizowane do wielkich liter', () => {
    const cfg = cfgMod.loadConfig();
    mod.applyConfig(fakeDaemon(cfg), {
      forward: { targets: [{ station_callsign: ' sp1aaa ', operator: ' sp1op ' }] },
    });
    assert.deepEqual(saved().forward.targets[0], { station_callsign: 'SP1AAA', operator: 'SP1OP' });
  });

  test('cel bez znaku stacji jest odfiltrowany', () => {
    const cfg = cfgMod.loadConfig();
    mod.applyConfig(fakeDaemon(cfg), {
      forward: { targets: [{ station_callsign: '' }, { station_callsign: 'SP1AAA' }] },
    });
    assert.equal(saved().forward.targets.length, 1);
  });

  // REGRESJA (zgłoszone z testów na Windows): po wpisaniu PIN-u interfejs nadal
  // pokazywał „brak PIN-u API". Flaga _pinMissing była liczona tylko przy
  // wczytaniu konfiguracji i nigdy po zapisie — komunikat wisiał aż do restartu.
  test('wpisanie PIN-u kasuje flagę „brak PIN-u"', () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'rdb-pin-'));
    writeFileSync(join(dir2, 'config.json'), JSON.stringify({
      ...BASE(), radiodyplom: { ...BASE().radiodyplom, pin: 'WSTAW-PIN' },
    }));
    process.env.RD_CONFIG_DIR = dir2;
    try {
      const cfg = cfgMod.loadConfig();
      assert.equal(cfg._pinMissing, true, 'placeholder = brak PIN-u');

      const d = fakeDaemon(cfg);
      mod.applyConfig(d, { radiodyplom: { pin: 'NOWY-1234' } });
      assert.equal(cfg._pinMissing, false, 'po wpisaniu PIN-u flaga musi zgasnąć');
    } finally {
      process.env.RD_CONFIG_DIR = dir;
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  test('skasowanie PIN-u ponownie zapala flagę', () => {
    const cfg = cfgMod.loadConfig();
    assert.equal(cfg._pinMissing, false);
    mod.applyConfig(fakeDaemon(cfg), { radiodyplom: { pin: 'WSTAW-PIN' } });
    assert.equal(cfg._pinMissing, true);
  });

  test('zmiana PIN-u wyzwala natychmiastowe sprawdzenie klucza', () => {
    const cfg = cfgMod.loadConfig();
    let pinged = 0;
    const d = { ...fakeDaemon(cfg), refreshPing: () => { pinged += 1; } };
    mod.applyConfig(d, { radiodyplom: { pin: 'NOWY-1234' } });
    assert.equal(pinged, 1, 'użytkownik ma od razu wiedzieć, czy PIN działa');
    mod.applyConfig(d, { radiodyplom: { dryRun: true } });
    assert.equal(pinged, 1, 'bez zmiany PIN-u nie pingujemy');
  });

  test('język jest zapisywany', () => {
    const cfg = cfgMod.loadConfig();
    mod.applyConfig(fakeDaemon(cfg), { language: 'en' });
    assert.equal(saved().language, 'en');
  });

  test('ścieżki kolejki zapisują się jako względne, nie rozwinięte', () => {
    const cfg = cfgMod.loadConfig();
    assert.ok(cfg.queue.dir.startsWith(dir), 'w pamięci są bezwzględne');
    mod.applyConfig(fakeDaemon(cfg), { radiodyplom: { dryRun: false } });
    assert.equal(saved().queue.dir, './data/queue', 'w pliku zostają względne');
  });
});

describe('baza operatorów', () => {
  test('PIN operatora jest zamaskowany w widoku dla interfejsu', () => {
    const view = mod.editableConfig(cfgMod.loadConfig());
    assert.equal(view.operators[0].call, 'SQ8BWM');
    assert.equal(view.operators[0].name, 'Marek');
    assert.equal(view.operators[0].pin, 'CCCC-****');
    assert.equal(view.operators[0].pinSet, true);
    assert.equal(JSON.stringify(view).includes('3333'), false);
  });

  test('zamaskowany PIN przy zapisie zostawia dotychczasowy', () => {
    // Najważniejszy przypadek: użytkownik poprawia opis, nie dotyka PIN-u.
    const cfg = cfgMod.loadConfig();
    const d = fakeDaemon(cfg);
    mod.applyConfig(d, { operators: [{ call: 'SQ8BWM', name: 'Marek H.', pin: 'CCCC-****' }] });
    assert.equal(saved().operators[0].pin, 'CCCC-3333');
    assert.equal(saved().operators[0].name, 'Marek H.');
  });

  test('poprawiony znak nie gubi PIN-u (dopasowanie po pozycji)', () => {
    const cfg = cfgMod.loadConfig();
    const d = fakeDaemon(cfg);
    mod.applyConfig(d, { operators: [{ call: 'SQ8BWX', name: 'Marek', pin: 'CCCC-****' }] });
    assert.equal(saved().operators[0].call, 'SQ8BWX');
    assert.equal(saved().operators[0].pin, 'CCCC-3333');
  });

  test('nowy PIN nadpisuje stary', () => {
    const cfg = cfgMod.loadConfig();
    mod.applyConfig(fakeDaemon(cfg), { operators: [{ call: 'SQ8BWM', pin: 'DDDD-4444' }] });
    assert.equal(saved().operators[0].pin, 'DDDD-4444');
  });

  test('usunięcie operatora znika też z pliku', () => {
    const cfg = cfgMod.loadConfig();
    mod.applyConfig(fakeDaemon(cfg), { operators: [] });
    assert.deepEqual(saved().operators, []);
  });

  test('baza trafia do listenera od razu, bez restartu', () => {
    const cfg = cfgMod.loadConfig();
    const d = fakeDaemon(cfg);
    const r = mod.applyConfig(d, { operators: [{ call: 'SP1AA', pin: 'EEEE-5555' }] });
    assert.deepEqual(d.listener.operators, [{ call: 'SP1AA', pin: 'EEEE-5555' }]);
    assert.deepEqual(r.restartRequired, []);
  });
});

describe('cel fan-outu wskazujący operatora', () => {
  test('pinFrom zapisuje się wielkimi literami', () => {
    const cfg = cfgMod.loadConfig();
    mod.applyConfig(fakeDaemon(cfg), {
      forward: { targets: [{ station_callsign: 'sp0xyz', pinFrom: 'sq8bwm' }] },
    });
    assert.equal(saved().forward.targets[0].station_callsign, 'SP0XYZ');
    assert.equal(saved().forward.targets[0].pinFrom, 'SQ8BWM');
  });

  test('wybór operatora usuwa stary PIN wpisany wprost', () => {
    // Inaczej wybór z bazy byłby bez efektu: PIN wprost ma pierwszeństwo,
    // więc kopia dalej leciałaby starym sekretem.
    const cfg = cfgMod.loadConfig();
    mod.applyConfig(fakeDaemon(cfg), {
      forward: { targets: [{ station_callsign: 'SQ8BWA', pinFrom: 'SQ8BWM' }] },
    });
    const t0 = saved().forward.targets[0];
    assert.equal(t0.pinFrom, 'SQ8BWM');
    assert.equal(t0.pin, undefined);
  });

  test('bez pinFrom zamaskowany PIN nadal jest zachowywany', () => {
    const cfg = cfgMod.loadConfig();
    mod.applyConfig(fakeDaemon(cfg), {
      forward: { targets: [{ station_callsign: 'SQ8BWA', operator: 'SQ8BWA', pin: 'BBBB-****' }] },
    });
    assert.equal(saved().forward.targets[0].pin, 'BBBB-2222');
  });
});

describe('zapis nie gubi sekcji, których interfejs nie zna', () => {
  // REGRESJA: plik był budowany od zera z ustalonej listy kluczy, więc każdy
  // zapis z UI wycinał logFile i radiodyplom.pingIntervalMs.
  test('logFile przeżywa zapis z interfejsu', () => {
    const cfg = cfgMod.loadConfig();
    mod.applyConfig(fakeDaemon(cfg), { radiodyplom: { dryRun: false } });
    assert.deepEqual(saved().logFile, { enabled: true, maxBytes: 1024, keep: 2 });
  });

  test('pingIntervalMs przeżywa zapis z interfejsu', () => {
    const cfg = cfgMod.loadConfig();
    mod.applyConfig(fakeDaemon(cfg), { radiodyplom: { dryRun: false } });
    assert.equal(saved().radiodyplom.pingIntervalMs, 30000);
  });
});
