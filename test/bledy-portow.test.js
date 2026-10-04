// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Komunikat po nieudanym otwarciu portu.
//
// ZGŁOSZONE 2026-10-04 z Windowsa: „odhaczyłem UDP i komunikat rdzeń nie działa”.
// Powód lądował na banerze w surowej postaci systemowej, czyli użytkownik widział
// tylko tyle, że program nie wstał. Komunikat ma mówić, co zrobić dalej.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

import { opisBleduPortu } from '../src/bledy-portow.js';
import { Logger32Listener } from '../src/tcp.js';
import { QsoPipeline } from '../src/qso-pipeline.js';
import { wolnyPortTcp } from './pomoc-porty.js';
import { setLevel } from '../src/log.js';

setLevel('error');

const gdzie = { protokol: 'TCP', host: '127.0.0.1', port: 52005, logger: 'Logger32' };

describe('opis błędu portu mówi, co zrobić', () => {
  test('zajęty port: kogo zamknąć albo co zmienić', () => {
    const o = opisBleduPortu({ code: 'EADDRINUSE' }, gdzie);
    assert.match(o, /zajęty/);
    assert.match(o, /Logger32/, 'ma przypomnieć o drugiej stronie ustawienia');
  });

  test('brak dostępu na Windowsie: zarezerwowany zakres, nie brak praw', () => {
    // Ludzie próbują wtedy „uruchom jako administrator” i tracą czas, bo to
    // zwykle nie o to chodzi — komunikat ma to powiedzieć wprost.
    const o = opisBleduPortu({ code: 'EACCES' }, { ...gdzie, system: 'win32' });
    assert.match(o, /zarezerwowany/);
    assert.match(o, /excludedportrange/, 'ma dać polecenie do sprawdzenia');
    assert.match(o, /NIE omija/, 'ma uprzedzić, że administrator nie pomoże');
  });

  test('brak dostępu na Linuksie: to porty poniżej 1024', () => {
    const o = opisBleduPortu({ code: 'EACCES' }, { ...gdzie, system: 'linux' });
    assert.match(o, /1024/);
    assert.doesNotMatch(o, /excludedportrange/, 'rada z Windowsa nie ma tu sensu');
  });

  test('adres spoza maszyny: podpowiadamy dwa sensowne', () => {
    const o = opisBleduPortu({ code: 'EADDRNOTAVAIL' }, { ...gdzie, host: '203.0.113.7' });
    assert.match(o, /nie należy do tej maszyny/);
    assert.match(o, /127\.0\.0\.1/);
    assert.match(o, /0\.0\.0\.0/);
  });

  test('nieznany błąd nie gubi treści systemowej', () => {
    // Gorzej niż surowy komunikat jest tylko komunikat ZASTĄPIONY ogólnikiem,
    // bo wtedy nie ma już czego wyszukać.
    const o = opisBleduPortu({ code: 'EPERM', message: 'operation not permitted' }, gdzie);
    assert.match(o, /operation not permitted/);
  });
});

describe('nasłuch TCP naprawdę oddaje ten komunikat', () => {
  // Nie atrapa błędu: zajmujemy port i sprawdzamy, co dostanie użytkownik.
  test('drugi nasłuch na tym samym porcie dostaje zdanie, nie kod', async () => {
    const port = await wolnyPortTcp();
    const potok = () => new QsoPipeline({
      operations: ['insert'], pin: 'X', targets: [], onQSO: () => {},
    });
    const zajmujacy = net.createServer();
    await new Promise((r) => zajmujacy.listen(port, '127.0.0.1', r));
    const nasluch = new Logger32Listener({ host: '127.0.0.1', port, pipeline: potok() });
    try {
      await assert.rejects(() => nasluch.start(), (err) => {
        assert.match(err.message, /zajęty/);
        assert.match(err.message, /Logger32/);
        assert.doesNotMatch(err.message, /EADDRINUSE/, 'kod systemowy nie jest komunikatem');
        return true;
      });
    } finally {
      nasluch.stop();
      await new Promise((r) => zajmujacy.close(r));
    }
  });
});
