// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Sygnalizacja problemów: „są odrzucone QSO, których jeszcze nie widziałeś".
//
// REGRESJA, którą zgłosił operator: pierwsza wersja trzymała licznik w pamięci
// workera. W spakowanej aplikacji rdzeń żyje w tym samym procesie co okno,
// więc zamknięcie programu kasowało sygnalizację — a odrzucone QSO zostawały
// na dysku. Plakietka znikała, choć problem trwał. Dlatego stan MUSI wynikać
// z zawartości failed/ i z trwale zapisanego potwierdzenia.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Store } from '../src/store.js';
import { requeueFailed } from '../src/requeue.js';
import { setLevel } from '../src/log.js';

setLevel('error');

let dir;
const paths = () => ({
  dir: join(dir, 'data', 'queue'),
  failedDir: join(dir, 'data', 'failed'),
  seenFile: join(dir, 'data', 'seen.json'),
});
const item = (key, call = 'SP9XYZ') => ({
  key, payload: { callsign: call, station_callsign: 'SN0LPU', operator: 'SQ8BWM' }, meta: {},
});

/**
 * Odkłada n QSO do failed/ tak, jak robi to worker przy odrzuceniu.
 * Odrzuca WYŁĄCZNIE to, co samo dodało — inaczej zabierałoby też QSO
 * przywrócone wcześniej do kolejki i test mierzyłby coś innego.
 */
function reject(store, n, markSeen = true) {
  const keys = [];
  for (let i = 0; i < n; i++) {
    const key = `k-${Math.random()}`;
    keys.push(key);
    store.enqueue(item(key, `SP${i}AAA`));
  }
  for (const it of store.list().filter((x) => keys.includes(x.key))) store.fail(it, markSeen);
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rdb-prob-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('sygnalizacja problemów', () => {
  test('bez odrzuconych nie ma czego sygnalizować', () => {
    const s = new Store(paths()); s.init();
    assert.equal(s.unackedFailed(), 0);
    s.release();
  });

  test('odrzucone QSO zapala sygnalizację', () => {
    const s = new Store(paths()); s.init();
    reject(s, 3);
    assert.equal(s.unackedFailed(), 3);
    s.release();
  });

  test('potwierdzenie gasi i mówi, ile było', () => {
    const s = new Store(paths()); s.init();
    reject(s, 2);
    assert.equal(s.ackFailed(), 2);
    assert.equal(s.unackedFailed(), 0);
    s.release();
  });

  test('potwierdzenie NIE usuwa odrzuconych QSO', () => {
    // Kasujemy ostrzeżenie, nie łączności — muszą dać się ponowić.
    const s = new Store(paths()); s.init();
    reject(s, 2);
    s.ackFailed();
    assert.equal(s.counts().failed, 2);
    assert.equal(s.listFailed().length, 2);
    s.release();
  });

  test('SYGNALIZACJA PRZEŻYWA RESTART', () => {
    // Sedno całej poprawki.
    const cfg = paths();
    const s1 = new Store(cfg); s1.init();
    reject(s1, 4);
    assert.equal(s1.unackedFailed(), 4);
    s1.release();

    const s2 = new Store(cfg); s2.init();
    assert.equal(s2.unackedFailed(), 4, 'po restarcie problem nadal jest widoczny');
    s2.release();
  });

  test('POTWIERDZENIE PRZEŻYWA RESTART', () => {
    const cfg = paths();
    const s1 = new Store(cfg); s1.init();
    reject(s1, 4);
    s1.ackFailed();
    s1.release();

    const s2 = new Store(cfg); s2.init();
    assert.equal(s2.unackedFailed(), 0, 'raz potwierdzone nie wraca po restarcie');
    assert.equal(s2.counts().failed, 4, 'a same QSO zostają');
    s2.release();
  });

  test('nowe odrzucenie po potwierdzeniu zapala od nowa', () => {
    const s = new Store(paths()); s.init();
    reject(s, 2);
    s.ackFailed();
    reject(s, 1);
    assert.equal(s.unackedFailed(), 1);
    s.release();
  });

  test('po przywróceniu odrzuconych nowe odrzucenie NIE jest przemilczane', () => {
    // Pułapka arytmetyki: potwierdzenie 4, potem „Ponów odrzucone" zeruje
    // failed/, a kolejne odrzucenie dałoby 1-4 = 0, czyli ciszę.
    const s = new Store(paths()); s.init();
    reject(s, 4, false);              // markSeen=false, żeby dało się ponowić
    s.ackFailed();
    assert.equal(s.unackedFailed(), 0);

    assert.equal(requeueFailed(s).restored, 4);
    assert.equal(s.counts().failed, 0);
    assert.equal(s.unackedFailed(), 0);

    reject(s, 1);
    assert.equal(s.unackedFailed(), 1, 'nowy problem musi być widoczny');
    s.release();
  });

  test('opróżnienie failed/ z zewnątrz nie zostawia zawyżonego potwierdzenia', () => {
    const s = new Store(paths()); s.init();
    reject(s, 3);
    s.ackFailed();
    rmSync(paths().failedDir, { recursive: true, force: true });
    assert.equal(s.unackedFailed(), 0, 'potwierdzenie przycięte do zera');
    s.release();

    // init odtwarza katalogi, więc dalsze odrzucenia znów się liczą
    const s2 = new Store(paths()); s2.init();
    reject(s2, 2);
    assert.equal(s2.unackedFailed(), 2);
    s2.release();
  });

  test('starszy seen.json bez pola potwierdzenia wczytuje się bez wyjątku', () => {
    const cfg = paths();
    const s1 = new Store(cfg); s1.init();
    reject(s1, 2);
    s1.release();
    // podmieniamy plik na format bez ackedFailed
    const d = JSON.parse(readFileSync(cfg.seenFile, 'utf8'));
    delete d.ackedFailed;
    writeFileSync(cfg.seenFile, JSON.stringify(d));

    const s2 = new Store(cfg); s2.init();
    assert.equal(s2.unackedFailed(), 2, 'brak pola = nic nie potwierdzone');
    s2.release();
  });
});
