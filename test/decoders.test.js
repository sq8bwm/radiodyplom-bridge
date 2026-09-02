// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Dekodery: rozpoznanie formatu i poprawność odczytu z każdego z trzech protokołów.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { pickDecoder } from '../src/decoders/index.js';
import * as qlog from '../src/decoders/qlog.js';
import * as n1mm from '../src/decoders/n1mm.js';
import * as wsjtx from '../src/decoders/wsjtx.js';
import { setLevel } from '../src/log.js';

setLevel('error'); // ciszej w testach

const OPS = new Set(['insert']);

// ---------- pomocnicze budowanie datagramów ----------
function qlogDatagram({ call = 'SP9XYZ', op = 'insert', rowid = 1, extra = '' } = {}) {
  const t = (n, v) => `<${n}:${String(v).length}>${v}`;
  const adif = t('call', call) + t('qso_date', '20260831') + t('time_on', '101500')
    + t('band', '40m') + t('mode', 'SSB') + t('station_callsign', 'SQ8BWM') + extra + '<eor>';
  return Buffer.from(JSON.stringify({
    appid: 'QLog', msgtype: 'qso', time: 1, logid: '{L}',
    data: { operation: op, rowid, type: 'adif', value: adif },
  }));
}

function wsjtxDatagram({ call = 'W1AW', jd = 2458866, msecs = 60218000, freqHz = 14074000,
  mode = 'FT8', operator = 'W2XYZ', myCall = 'W2XYZ' } = {}) {
  const parts = [];
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v); parts.push(b); };
  const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(v)); parts.push(b); };
  const i64 = (v) => { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v)); parts.push(b); };
  const i8 = (v) => { const b = Buffer.alloc(1); b.writeInt8(v); parts.push(b); };
  const str = (s) => { const b = Buffer.from(String(s), 'utf8'); u32(b.length); parts.push(b); };
  const dt = () => { i64(jd); u32(msecs); i8(1); };

  u32(0xadbccbda); u32(2); u32(5); str('WSJT-X');
  dt(); str(call); str('FN31'); u64(freqHz); str(mode);
  str('-10'); str('-12'); str('50'); str('c'); str('n');
  dt(); str(operator); str(myCall); str('KO02'); str(''); str('');
  return Buffer.concat(parts);
}

const N1MM_XML = (over = {}) => {
  const f = {
    call: 'W1AW', mycall: 'W2XYZ', operator: '', mode: 'USB',
    txfreq: '352519', band: '3.5', snt: '599', rcv: '599',
    timestamp: '2020-01-17 16:43:38', ID: 'abc123', ...over,
  };
  return Buffer.from(`<?xml version="1.0"?><contactinfo>
    <app>N1MM</app><timestamp>${f.timestamp}</timestamp><mycall>${f.mycall}</mycall>
    <band>${f.band}</band><txfreq>${f.txfreq}</txfreq><rxfreq>${f.txfreq}</rxfreq>
    <operator>${f.operator}</operator><mode>${f.mode}</mode><call>${f.call}</call>
    <snt>${f.snt}</snt><rcv>${f.rcv}</rcv><ID>${f.ID}</ID></contactinfo>`);
};

// ---------- rozpoznanie formatu ----------
describe('rozpoznanie formatu datagramu', () => {
  test('trzy rodziny są rozłączne i trafiają do właściwego dekodera', () => {
    assert.equal(pickDecoder(qlogDatagram()).name, 'QLog');
    assert.equal(pickDecoder(N1MM_XML()).name, 'N1MM');
    assert.equal(pickDecoder(wsjtxDatagram()).name, 'WSJT-X');
  });

  test('śmieci nie są rozpoznawane (zamiast trafiać losowo)', () => {
    assert.equal(pickDecoder(Buffer.from('garbage-not-a-protocol')), null);
    assert.equal(pickDecoder(Buffer.alloc(0)), null);
  });
});

// ---------- QLog ----------
describe('dekoder QLog', () => {
  test('czyta rekord i buduje klucz z logid, rowid oraz odcisku treści', () => {
    const r = qlog.decode(qlogDatagram({ rowid: 42 }), { operations: OPS });
    assert.equal(r.adif.call, 'SP9XYZ');
    assert.match(r.key, /^qlog:\{L\}#42:[0-9a-f]{12}$/);
    assert.equal(r.meta.source, 'QLog');
  });

  test('ten sam rekord daje ten sam klucz (dedup działa)', () => {
    const a = qlog.decode(qlogDatagram({ rowid: 7 }), { operations: OPS });
    const b = qlog.decode(qlogDatagram({ rowid: 7 }), { operations: OPS });
    assert.equal(a.key, b.key);
  });

  // REGRESJA (2026-08-31, realna utrata QSO): rowid pochodzi z SQLite i jest
  // ponownie używany po skasowaniu rekordu. Klucz oparty na samym rowid sprawiał,
  // że nowe QSO z odzyskanym numerem znikało jako rzekomy duplikat.
  test('ten sam rowid z INNYM QSO daje inny klucz', () => {
    const a = qlog.decode(qlogDatagram({ rowid: 54300, call: 'SP4OIK' }), { operations: OPS });
    const b = qlog.decode(qlogDatagram({ rowid: 54300, call: 'SP7VCL' }), { operations: OPS });
    assert.notEqual(a.key, b.key, 'odzyskany rowid nie może kasować nowego QSO');
  });

  // Druga strona medalu: ponowne zalogowanie tej samej łączności w loggerze
  // (reakcja operatora, gdy coś nie doszło) dostaje nowy rowid i MUSI przejść.
  test('to samo QSO po przelogowaniu (nowy rowid) nie jest blokowane', () => {
    const a = qlog.decode(qlogDatagram({ rowid: 100, call: 'SP4OIK' }), { operations: OPS });
    const b = qlog.decode(qlogDatagram({ rowid: 999, call: 'SP4OIK' }), { operations: OPS });
    assert.notEqual(a.key, b.key);
  });

  test('operacje inne niż insert są pomijane, nie przetwarzane', () => {
    for (const op of ['update', 'delete']) {
      const r = qlog.decode(qlogDatagram({ op }), { operations: OPS });
      assert.ok(r.skip, `operacja ${op} powinna być pominięta`);
    }
  });

  test('obcy JSON nie jest brany za QSO', () => {
    const foreign = Buffer.from(JSON.stringify({ appid: 'Inny', msgtype: 'qso' }));
    assert.equal(qlog.decode(foreign, { operations: OPS }), null);
  });
});

// ---------- N1MM ----------
describe('dekoder N1MM', () => {
  // REGRESJA: <txfreq> jest w jednostkach 10 Hz, nie w Hz. Potraktowanie tego
  // jako Hz dawało pasmo null i QSO było odrzucane.
  test('txfreq w jednostkach 10 Hz przelicza się na właściwe pasmo', () => {
    const r = n1mm.decode(N1MM_XML());
    assert.equal(r.adif.band, '80m', '352519 * 10 Hz = 3.52519 MHz');
    assert.equal(r.adif.freq, '3.52519');
  });

  test('USB jest normalizowane do SSB', () => {
    assert.equal(n1mm.decode(N1MM_XML()).adif.mode, 'SSB');
  });

  test('pusty <operator> spada na znak stacji, nie zostaje pusty', () => {
    assert.equal(n1mm.decode(N1MM_XML()).adif.operator, 'W2XYZ');
  });

  test('podany operator nie jest nadpisywany znakiem stacji', () => {
    const r = n1mm.decode(N1MM_XML({ operator: 'SP9OP' }));
    assert.equal(r.adif.operator, 'SP9OP');
    assert.equal(r.adif.station_callsign, 'W2XYZ');
  });

  test('timestamp rozbija się na datę i czas', () => {
    const r = n1mm.decode(N1MM_XML());
    assert.equal(r.adif.qso_date, '20200117');
    assert.equal(r.adif.time_on, '164338');
  });

  test('klucz łączy <ID> z odciskiem treści i jest stabilny', () => {
    const a = n1mm.decode(N1MM_XML());
    const b = n1mm.decode(N1MM_XML());
    assert.match(a.key, /^n1mm:abc123:[0-9a-f]{12}$/);
    assert.equal(a.key, b.key);
  });

  test('ten sam <ID> z innym QSO daje inny klucz', () => {
    const a = n1mm.decode(N1MM_XML({ call: 'W1AW' }));
    const b = n1mm.decode(N1MM_XML({ call: 'W9XYZ' }));
    assert.notEqual(a.key, b.key);
  });

  test('contactreplace/contactdelete są pomijane', () => {
    const xml = Buffer.from('<?xml version="1.0"?><contactdelete><call>W1AW</call></contactdelete>');
    assert.ok(n1mm.decode(xml).skip);
  });

  test('brak <band> i zerowy txfreq nie wywala dekodera', () => {
    const r = n1mm.decode(N1MM_XML({ txfreq: '0', band: '0' }));
    assert.equal(r.adif.band, undefined);
    assert.equal(r.adif.call, 'W1AW');
  });
});

// ---------- WSJT-X ----------
describe('dekoder WSJT-X', () => {
  // REGRESJA: QDateTime to Julian Day + ms od północy. Błąd w konwersji
  // dawałby QSO z zupełnie inną datą.
  test('Julian Day + ms przelicza się na właściwą datę i czas', () => {
    const r = wsjtx.decode(wsjtxDatagram());
    assert.equal(r.adif.qso_date, '20200117');
    assert.equal(r.adif.time_on, '164338');
  });

  test('częstotliwość w Hz daje pasmo', () => {
    const r = wsjtx.decode(wsjtxDatagram());
    assert.equal(r.adif.band, '20m');
    assert.equal(r.adif.freq, '14.074');
  });

  test('klucz syntetyczny jest deterministyczny dla tego samego datagramu', () => {
    const buf = wsjtxDatagram();
    assert.equal(wsjtx.decode(buf).key, wsjtx.decode(buf).key);
  });

  test('klucz syntetyczny różni się, gdy QSO się różni', () => {
    const a = wsjtx.decode(wsjtxDatagram({ call: 'W1AW' })).key;
    const b = wsjtx.decode(wsjtxDatagram({ call: 'W1XYZ' })).key;
    assert.notEqual(a, b);
  });

  test('inne typy komunikatów niż QSO Logged są pomijane', () => {
    const buf = wsjtxDatagram();
    buf.writeUInt32BE(1, 8); // typ 1 = Status
    assert.ok(wsjtx.decode(buf).skip);
  });

  test('uszkodzony datagram daje błąd, nie wyjątek', () => {
    const r = wsjtx.decode(wsjtxDatagram().subarray(0, 20));
    assert.ok(r.error, 'powinien zwrócić opisany błąd');
  });
});
