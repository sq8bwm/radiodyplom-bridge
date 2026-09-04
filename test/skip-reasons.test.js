// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Powody pominięcia datagramów.
//
// Po co: okno pokazywało „pominięte świadomie: 4" i nie dawało się dowiedzieć,
// czego to dotyczyło — powód szedł do logu na poziomie `debug`, a domyślnie
// program pracuje na `info`. Pytanie „skąd te cztery?" padło 2026-09-04
// i nie było na nie odpowiedzi w programie.
//
// Powodów NIE logujemy na `info`, bo WSJT-X nadaje komunikaty stanu co sekundę
// i zalałby log. Zamiast tego zliczamy je i pokazujemy w oknie.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { LoggerListener } from '../src/udp.js';
import { setLevel } from '../src/log.js';

setLevel('error');

/** Nasłuch bez gniazda — `_handle` da się wołać wprost. */
function listener(operations = ['insert']) {
  return new LoggerListener({
    host: '127.0.0.1', port: 0, operations, pin: 'X',
    targets: [], onQSO: () => {},
  });
}

const qlog = (operation, call = 'SP1AAA', rowid = 1) => Buffer.from(JSON.stringify({
  appid: 'QLog', msgtype: 'qso', logid: 'test',
  data: {
    operation, type: 'adif', rowid,
    value: `<call:${call.length}>${call}<band:3>40m<mode:3>SSB<qso_date:8>20260904`
      + '<time_on:4>1030<station_callsign:6>SQ8BWM<freq:5>7.140<eor>',
  },
}));

const rinfo = { address: '127.0.0.1', port: 55555 };

describe('zliczanie powodów pominięcia', () => {
  let l;
  beforeEach(() => { l = listener(); });

  test('edycja QSO w loggerze jest pomijana i policzona z powodem', () => {
    l._handle(qlog('update'), rinfo);
    assert.equal(l.stats.skipped, 1);
    assert.equal(l.stats.accepted, 0);
    assert.deepEqual(Object.keys(l.stats.skipReasons), ['operacja "update"']);
    assert.equal(l.stats.skipReasons['operacja "update"'], 1);
  });

  test('różne powody trafiają do osobnych kubełków', () => {
    l._handle(qlog('update'), rinfo);
    l._handle(qlog('update'), rinfo);
    l._handle(qlog('delete'), rinfo);
    assert.equal(l.stats.skipped, 3);
    assert.equal(l.stats.skipReasons['operacja "update"'], 2);
    assert.equal(l.stats.skipReasons['operacja "delete"'], 1);
  });

  test('QSO przepuszczone nie trafia do powodów', () => {
    l._handle(qlog('insert'), rinfo);
    assert.equal(l.stats.accepted, 1);
    assert.deepEqual(l.stats.skipReasons, {});
  });

  test('suma pominięć zgadza się z sumą powodów', () => {
    // To jest ta relacja, której brak rodził pytanie „skąd te cztery".
    for (const op of ['update', 'delete', 'update', 'cokolwiek']) l._handle(qlog(op), rinfo);
    const suma = Object.values(l.stats.skipReasons).reduce((a, b) => a + b, 0);
    assert.equal(suma, l.stats.skipped);
  });

  test('źródło nadające śmieci nie rozdmucha licznika bez końca', () => {
    // Powodów jest z natury kilka. Limit stoi na wypadek nadawcy, który
    // wstawia do operacji zmienną treść — inaczej mapa rosłaby bez granic.
    for (let i = 0; i < 60; i++) l._handle(qlog(`operacja-${i}`), rinfo);
    assert.equal(l.stats.skipped, 60, 'wszystkie policzone jako pominięte');
    assert.ok(Object.keys(l.stats.skipReasons).length <= 20, 'ale powodów najwyżej 20');
  });

  test('konfiguracja przepuszczająca update zmienia wynik', () => {
    // Sprawdza, że pomijanie wynika z `forward.operations`, a nie z twardej
    // reguły w dekoderze.
    const l2 = listener(['insert', 'update']);
    l2._handle(qlog('update'), rinfo);
    assert.equal(l2.stats.skipped, 0);
    assert.equal(l2.stats.accepted, 1);
  });
});
