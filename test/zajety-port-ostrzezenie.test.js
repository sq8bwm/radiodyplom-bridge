// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Cudzy nasłuch na naszym porcie UDP.
//
// SKĄD TO SIĘ WZIĘŁO: port 12060 nie jest „nasz" ani HamConnecta — to domyślny
// port rodziny N1MM i używa go każdy, kto odbiera QSO z loggerów. Gdy dwa takie
// programy działają naraz, datagram dostaje TYLKO JEDEN z nich.
//
// Zmierzone 2026-10-05 na obu systemach, tym samym kodem:
//   Windows 11 → odbiera ten, który zbindował się PIERWSZY
//   Linux      → odbiera ten, który zbindował się PÓŹNIEJ
//
// A nasz bind z `reuseAddr` (konieczny dla multicastu WSJT-X) udaje się w obu
// przypadkach, więc bez sondy użytkownik nie dostaje ŻADNEGO sygnału — po prostu
// połowa QSO przepada i wygląda to na usterkę loggera.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';

import { LoggerListener } from '../src/udp.js';
import { QsoPipeline } from '../src/qso-pipeline.js';
import { ostrzezenieOCudzymNasluchu } from '../src/bledy-portow.js';
import { setLevel, recentLog } from '../src/log.js';
import { wolnyPortUdp } from './pomoc-porty.js';

const sprzatanie = [];
after(async () => { for (const f of sprzatanie) await f(); });

/** Udaje cudzy program (HamConnect i spółka): binduje z reuseAddr, tak jak my. */
function cudzyNasluch(port) {
  return new Promise((gotowe, blad) => {
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    s.once('error', blad);
    s.bind(port, '127.0.0.1', () => {
      sprzatanie.push(() => new Promise((r) => s.close(r)));
      gotowe(s);
    });
  });
}

async function nasluchMostka(port) {
  const l = new LoggerListener({
    host: '127.0.0.1', port,
    pipeline: new QsoPipeline({ operations: ['insert'], pin: 'TEST', targets: [], onQSO: () => {} }),
  });
  await l.start();
  sprzatanie.push(() => l.stop());
  return l;
}

const logJakoTekst = () => recentLog(30).map((w) => w.msg).join('\n');

describe('ostrzeżenie o cudzym nasłuchu', () => {
  test('cudzy program na naszym porcie zostawia OSTRZEŻENIE w logu', async () => {
    setLevel('warn');
    try {
      const port = await wolnyPortUdp();
      await cudzyNasluch(port);
      await nasluchMostka(port);
      const tekst = logJakoTekst();
      assert.match(tekst, /trzyma już inny program/);
      assert.match(tekst, new RegExp(String(port)), 'ma być widać, KTÓRY port');
      assert.match(tekst, /TYLKO JEDEN/, 'skutek musi być nazwany wprost');
    } finally { setLevel('error'); }
  });

  test('mostek mimo to WSTAJE — nie odbieramy decyzji użytkownikowi', async () => {
    setLevel('warn');
    try {
      const port = await wolnyPortUdp();
      await cudzyNasluch(port);
      const l = await nasluchMostka(port);
      assert.ok(l.socket, 'nasłuch miał wstać mimo cudzego gniazda');
      assert.equal(l.socket.address().port, port);
    } finally { setLevel('error'); }
  });

  test('wolny port NIE wywołuje fałszywego alarmu', async () => {
    setLevel('warn');
    try {
      const port = await wolnyPortUdp();
      await nasluchMostka(port);
      // Bufor logu jest WSPÓLNY dla całego przebiegu, więc siedzą w nim ostrzeżenia
      // z testów wyżej. Pytamy więc o ostrzeżenie dotyczące TEGO portu.
      const oTymPorcie = recentLog(30).filter((w) => w.msg.includes(String(port)));
      assert.deepEqual(oTymPorcie.filter((w) => /trzyma już inny program/.test(w.msg)), []);
    } finally { setLevel('error'); }
  });
});

describe('treść ostrzeżenia', () => {
  test('mówi, kto dostaje datagram — inaczej na Windowsie, inaczej na Linuksie', () => {
    const w = ostrzezenieOCudzymNasluchu({ host: '127.0.0.1', port: 12060, system: 'win32' });
    const l = ostrzezenieOCudzymNasluchu({ host: '127.0.0.1', port: 12060, system: 'linux' });
    assert.match(w, /PIERWSZY/);
    assert.match(l, /PÓŹNIEJ/);
    assert.notEqual(w, l, 'kolejność jest odwrotna, więc komunikat nie może być ten sam');
  });

  test('podaje port i konkretną radę, a nie samo „coś jest nie tak"', () => {
    const t = ostrzezenieOCudzymNasluchu({ host: '0.0.0.0', port: 12345, system: 'linux' });
    assert.match(t, /0\.0\.0\.0:12345/);
    assert.match(t, /udp\.port/, 'ma powiedzieć, co zmienić u nas');
    assert.match(t, /w tamtym programie/, 'i że da się zmienić po tamtej stronie');
  });
});
