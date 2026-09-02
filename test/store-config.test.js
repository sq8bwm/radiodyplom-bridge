// Trwała kolejka, blokady i konfiguracja. Testy operują na katalogach
// tymczasowych, więc nie dotykają ani projektu, ani danych użytkownika.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Store } from '../src/store.js';
import { requeueFailed } from '../src/requeue.js';
import { acquireLock, releaseLock, isAlive, udpLockPath } from '../src/lock.js';
import { setLevel } from '../src/log.js';

setLevel('error');

let dir;
const paths = () => ({
  dir: join(dir, 'data', 'queue'),
  failedDir: join(dir, 'data', 'failed'),
  seenFile: join(dir, 'data', 'seen.json'),
});
const item = (key, call = 'SP9XYZ', station = 'SQ8BWM') => ({
  key, payload: { callsign: call, station_callsign: station, operator: 'SP9LOG' }, meta: {},
});

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rdb-test-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('Store — kolejka', () => {
  test('dodanie i policzenie', () => {
    const s = new Store(paths()); s.init();
    assert.equal(s.enqueue(item('a')), true);
    assert.equal(s.counts().pending, 1);
    assert.equal(s.list()[0].payload.callsign, 'SP9XYZ');
    s.release();
  });

  test('ten sam klucz nie wchodzi dwa razy', () => {
    const s = new Store(paths()); s.init();
    assert.equal(s.enqueue(item('a')), true);
    assert.equal(s.enqueue(item('a')), false, 'dedup po kluczu');
    assert.equal(s.counts().pending, 1);
    s.release();
  });

  test('klucz obsłużony nie wraca do kolejki', () => {
    const s = new Store(paths()); s.init();
    s.enqueue(item('a'));
    s.complete(s.list()[0]);
    assert.equal(s.counts().pending, 0);
    assert.equal(s.counts().sent, 1);
    assert.equal(s.enqueue(item('a')), false, 'raz wysłane nie wraca');
    s.release();
  });

  test('kolejka przeżywa restart procesu', () => {
    const p = paths();
    const s1 = new Store(p); s1.init();
    s1.enqueue(item('a')); s1.enqueue(item('b'));
    s1.complete(s1.list()[0]);
    s1.release();

    const s2 = new Store(p); s2.init();
    assert.equal(s2.counts().pending, 1);
    assert.equal(s2.counts().sent, 1);
    assert.equal(s2.enqueue(item('a')), false, 'seen wczytane z dysku');
    s2.release();
  });

  // REGRESJA: błąd trwały i wyczerpanie prób z powodu sieci to różne sprawy.
  // Oznaczenie awarii sieci jako "obsłużone" uniemożliwiało odzyskanie QSO.
  test('odrzucenie przez serwer blokuje ponowienie, awaria sieci nie', () => {
    const s = new Store(paths()); s.init();

    s.enqueue(item('trwaly'));
    s.fail(s.list().find((i) => i.key === 'trwaly'), true);   // serwer odrzucił
    assert.equal(s.enqueue(item('trwaly')), false, 'trwałe odrzucenie zostaje');

    s.enqueue(item('siec'));
    s.fail(s.list().find((i) => i.key === 'siec'), false);    // awaria łączności
    assert.equal(s.seen.has('siec'), false, 'awaria sieci nie oznacza jako obsłużone');
    s.release();
  });

  test('requeueFailed przywraca tylko to, co da się jeszcze wysłać', () => {
    const s = new Store(paths()); s.init();
    s.enqueue(item('trwaly')); s.fail(s.list().find((i) => i.key === 'trwaly'), true);
    s.enqueue(item('siec'));   s.fail(s.list().find((i) => i.key === 'siec'), false);
    assert.equal(s.counts().failed, 2);

    const r = requeueFailed(s);
    assert.equal(r.restored, 1, 'wraca tylko awaria sieci');
    assert.equal(r.skipped, 1);
    assert.equal(s.counts().pending, 1);
    s.release();
  });

  // REGRESJA: nazwa pliku była wyciągana przez split('/'), co na Windows
  // (separator "\") rozsypywało przenoszenie do failed/.
  test('przenoszenie do failed/ działa niezależnie od separatora ścieżek', () => {
    const s = new Store(paths()); s.init();
    s.enqueue(item('a'));
    s.fail(s.list()[0], true);
    assert.equal(s.counts().failed, 1);
    assert.equal(s.listFailed()[0].payload.callsign, 'SP9XYZ');
    s.release();
  });

  test('uszkodzony plik w kolejce nie wywala odczytu', () => {
    const p = paths();
    const s = new Store(p); s.init();
    s.enqueue(item('a'));
    writeFileSync(join(p.dir, 'zepsuty.json'), '{ to nie jest json');
    assert.equal(s.list().length, 1, 'pomija uszkodzony, czyta dobry');
    s.release();
  });

  test('pole runtime _file nie trafia do zapisanego pliku', () => {
    const p = paths();
    const s = new Store(p); s.init();
    s.enqueue(item('a'));
    const raw = JSON.parse(readFileSync(s.list()[0]._file, 'utf8'));
    assert.ok(!('_file' in raw));
    s.release();
  });
});

describe('Blokady', () => {
  test('ta sama instancja procesu może przejąć własną blokadę', () => {
    // Świadome zachowanie: blokada chroni przed DRUGIM PROCESEM, nie przed
    // ponownym init w tym samym procesie (np. po zmianie konfiguracji).
    const p = paths();
    const s1 = new Store(p); s1.init();
    const s2 = new Store(p);
    assert.doesNotThrow(() => s2.init());
    s2.release();
  });

  test('drugi PROCES na tym samym katalogu danych dostaje odmowę', async () => {
    const p = paths();
    const lockFile = join(dir, 'data', '.lock');
    mkdirSync(join(dir, 'data'), { recursive: true });

    // dziecko zajmuje blokadę i żyje, dopóki go nie zamkniemy
    const lockUrl = new URL('../src/lock.js', import.meta.url).href;
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { acquireLock } from ${JSON.stringify(lockUrl)};
      acquireLock(${JSON.stringify(lockFile)}, 'Katalog danych', 'x');
      process.stdout.write('gotowe\\n');
      setInterval(() => {}, 1000);
    `], { stdio: ['ignore', 'pipe', 'inherit'] });

    await new Promise((res, rej) => {
      child.stdout.on('data', (d) => String(d).includes('gotowe') && res());
      child.on('exit', () => rej(new Error('dziecko padło zanim zajęło blokadę')));
      setTimeout(() => rej(new Error('timeout')), 10000);
    });

    try {
      const s = new Store(p);
      assert.throws(() => s.init(), /Katalog danych jest już używany/);
    } finally {
      child.kill('SIGKILL');
    }
  });

  test('po zwolnieniu druga instancja wstaje', () => {
    const p = paths();
    const s1 = new Store(p); s1.init(); s1.release();
    const s2 = new Store(p);
    assert.doesNotThrow(() => s2.init());
    s2.release();
  });

  test('blokada po nieżyjącym procesie jest przejmowana', () => {
    const f = join(dir, 'x.lock');
    writeFileSync(f, JSON.stringify({ pid: 999999, at: 'x' }));  // PID, który nie istnieje
    assert.doesNotThrow(() => acquireLock(f, 'Coś', 'podpowiedź'));
    releaseLock(f);
  });

  test('blokada żywego procesu jest respektowana', () => {
    const f = join(dir, 'y.lock');
    acquireLock(f, 'Coś', 'podpowiedź');
    // podszywamy się pod inny, żywy proces (proces macierzysty)
    writeFileSync(f, JSON.stringify({ pid: process.ppid, at: 'x' }));
    assert.throws(() => acquireLock(f, 'Coś', 'podpowiedź'), /już używany/);
  });

  test('releaseLock nie usuwa cudzej blokady', () => {
    const f = join(dir, 'z.lock');
    writeFileSync(f, JSON.stringify({ pid: process.ppid, at: 'x' }));
    releaseLock(f);
    assert.ok(existsSync(f), 'cudza blokada zostaje');
  });

  test('isAlive rozpoznaje własny proces', () => {
    assert.equal(isAlive(process.pid), true);
    assert.equal(isAlive(999999), false);
  });

  // Blokada portu musi leżeć POZA katalogiem danych — inaczej dwie instancje
  // z różnymi dataDir wciąż walczyłyby o ten sam port UDP.
  test('ścieżka blokady portu jest niezależna od katalogu danych', () => {
    const p = udpLockPath('127.0.0.1', 12060);
    assert.ok(p.includes('12060'));
    assert.ok(p.startsWith(tmpdir()));
    assert.notEqual(udpLockPath('0.0.0.0', 12060), p, 'host wchodzi do nazwy');
  });
});

describe('Konfiguracja', () => {
  const BASE = {
    udp: { host: '127.0.0.1', port: 12060, multicastGroups: [] },
    radiodyplom: { apiUrl: 'https://x/api', pin: 'ABCD-1234', timeoutMs: 1000, dryRun: true },
    forward: { operations: ['insert'], targets: [] },
    queue: { dir: './data/queue', failedDir: './data/failed', seenFile: './data/seen.json', maxAttempts: 20, baseDelayMs: 5000, maxDelayMs: 900000 },
    rateLimit: { maxPerMinute: 9, minSpacingMs: 700 },
    api: { enabled: true, port: 12061 },
    logLevel: 'info',
  };

  async function loadFresh(cfgDir) {
    process.env.RD_CONFIG_DIR = cfgDir;
    // świeży import, żeby moduł policzył ścieżki od nowa
    const mod = await import(`../src/config.js?t=${Date.now()}${Math.random()}`);
    return mod;
  }

  afterEach(() => { delete process.env.RD_CONFIG_DIR; delete process.env.RD_PIN; });

  test('RD_CONFIG_DIR przekierowuje plik konfiguracji', async () => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify(BASE));
    const { loadConfig, configPath } = await loadFresh(dir);
    assert.equal(configPath(), join(dir, 'config.json'));
    assert.equal(loadConfig()._source, join(dir, 'config.json'));
  });

  test('ścieżki względne liczą się od katalogu konfiguracji', async () => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify(BASE));
    const { loadConfig } = await loadFresh(dir);
    assert.equal(loadConfig().queue.dir, join(dir, 'data', 'queue'));
  });

  test('dataDir "auto" kieruje dane do katalogu systemowego', async () => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ ...BASE, dataDir: 'auto' }));
    const { loadConfig, defaultDataDir } = await loadFresh(dir);
    assert.ok(loadConfig().queue.dir.startsWith(defaultDataDir()));
  });

  // Brak PIN-u nie może być błędem krytycznym: w wersji instalowanej
  // użytkownik wpisuje go dopiero w interfejsie.
  test('brak PIN-u jest odnotowany, ale nie wywala wczytywania', async () => {
    writeFileSync(join(dir, 'config.json'),
      JSON.stringify({ ...BASE, radiodyplom: { ...BASE.radiodyplom, pin: '' } }));
    const { loadConfig } = await loadFresh(dir);
    assert.equal(loadConfig()._pinMissing, true);
  });

  test('placeholder WSTAW-PIN jest rozpoznawany jako brak PIN-u', async () => {
    writeFileSync(join(dir, 'config.json'),
      JSON.stringify({ ...BASE, radiodyplom: { ...BASE.radiodyplom, pin: 'WSTAW-PIN' } }));
    const { loadConfig } = await loadFresh(dir);
    assert.equal(loadConfig()._pinMissing, true);
  });

  test('RD_PIN nadpisuje PIN z pliku', async () => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify(BASE));
    process.env.RD_PIN = 'ZZZZ-9999';
    const { loadConfig } = await loadFresh(dir);
    assert.equal(loadConfig().radiodyplom.pin, 'ZZZZ-9999');
  });

  test('nie-lista w targets jest odrzucana', async () => {
    writeFileSync(join(dir, 'config.json'),
      JSON.stringify({ ...BASE, forward: { targets: 'nie-lista' } }));
    const { loadConfig } = await loadFresh(dir);
    assert.throws(() => loadConfig(), /musi być listą/);
  });

  test('cel bez znaku stacji jest odrzucany', async () => {
    writeFileSync(join(dir, 'config.json'),
      JSON.stringify({ ...BASE, forward: { targets: [{ operator: 'X' }] } }));
    const { loadConfig } = await loadFresh(dir);
    assert.throws(() => loadConfig(), /wymaga station_callsign/);
  });
});

describe('licznik wysłanych jest osobny od deduplikacji', () => {
  // REGRESJA: `sent` był rozmiarem zbioru `seen`, a `seen` obejmuje też trwałe
  // odrzucenia. Licznik „WYSŁANE" rósł więc przy każdym odrzuceniu i mówił
  // użytkownikowi, że QSO doszło do radiodyplom.
  test('trwałe odrzucenie NIE zwiększa licznika wysłanych', () => {
    const s = new Store(paths());
    s.init();
    s.enqueue(item('a', 'SP1AAA'));
    s.enqueue(item('b', 'SP2BBB'));
    const [i1, i2] = s.list();

    s.complete(i1);
    s.fail(i2, true);                 // odrzucone trwale – trafia do seen

    const c = s.counts();
    assert.equal(c.sent, 1, 'wysłane liczymy tylko po sukcesie');
    assert.equal(c.failed, 1);
    assert.equal(s.seen.size, 2, 'a dedup nadal zna oba klucze');
    s.release();
  });

  test('licznik przeżywa restart', () => {
    const cfg = paths();
    const s = new Store(cfg);
    s.init();
    s.enqueue(item('x', 'SP3CCC'));
    s.complete(s.list()[0]);
    s.release();

    const s2 = new Store(cfg);
    s2.init();
    assert.equal(s2.counts().sent, 1);
    s2.release();
  });

  test('starszy seen.json (tablica) jest wczytywany bez utraty statystyki', () => {
    const cfg = paths();
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(cfg.seenFile, JSON.stringify(['k1', 'k2', 'k3']));
    const s = new Store(cfg);
    s.init();
    assert.equal(s.seen.size, 3, 'klucze deduplikacji zachowane');
    assert.equal(s.counts().sent, 3, 'i dotychczasowa liczba, żeby jej nie wyzerować');
    s.release();
  });
});

describe('odzyskiwanie QSO odrzuconego lokalnie', () => {
  // Cała droga powrotna: brak operatora w bazie → odrzucenie → dopisanie
  // operatora → „Ponów odrzucone" → QSO znów w kolejce.
  test('requeueFailed przywraca QSO, którego nie wysłaliśmy', () => {
    const s = new Store(paths());
    s.init();
    s.enqueue(item('k1', 'SP3CCC'));
    const it = s.list()[0];

    s.fail(it, false);                        // tak odkłada je worker
    assert.equal(s.counts().failed, 1);
    assert.equal(s.seen.has('k1'), false, 'klucz nie może być zamknięty');

    const r = requeueFailed(s);
    assert.equal(r.restored, 1);
    assert.equal(s.counts().pending, 1);
    assert.equal(s.counts().failed, 0);
    s.release();
  });

  test('QSO zamknięte jako obsłużone NIE wraca', () => {
    // Odwrotny biegun: odrzucenie przez serwer (zły znak) ma zostać odrzucone.
    const s = new Store(paths());
    s.init();
    s.enqueue(item('k2', 'SP4DDD'));
    s.fail(s.list()[0], true);

    assert.equal(requeueFailed(s).restored, 0);
    assert.equal(s.counts().failed, 1);
    s.release();
  });
});
