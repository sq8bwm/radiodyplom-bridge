// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Wolny port od systemu, zamiast numeru wpisanego na sztywno w teście.
//
// PO CO: test ze stałym portem pada nie wtedy, gdy kod jest zły, tylko wtedy,
// gdy ktoś inny trzyma ten port — działający mostek na maszynie dewelopera,
// drugi przebieg testów, cokolwiek. Taka porażka nie niesie żadnej informacji,
// a kosztuje czyjś czas na szukanie nieistniejącego błędu.
//
// Zmierzone 2026-10-04: przy dwóch zestawach testów naraz padało ok. 30 testów
// na przebieg, wszystkie wyłącznie z powodu zajętych portów.
//
// Wyścig jest teoretycznie możliwy (ktoś zajmie port między zamknięciem naszego
// gniazda a użyciem numeru przez test), ale okno liczy się w milisekundach i
// nie rośnie z obciążeniem maszyny — w odróżnieniu od kolizji na stałym porcie,
// która jest pewna, gdy tylko drugi proces go weźmie.
import net from 'node:net';
import dgram from 'node:dgram';

/** Wolny port TCP na 127.0.0.1. */
export function wolnyPortTcp() {
  return new Promise((gotowe, blad) => {
    const s = net.createServer();
    s.once('error', blad);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => gotowe(port));
    });
  });
}

/** Wolny port UDP na 127.0.0.1. Osobno, bo numeracja TCP i UDP jest niezależna. */
export function wolnyPortUdp() {
  return new Promise((gotowe, blad) => {
    const s = dgram.createSocket('udp4');
    s.once('error', blad);
    s.bind({ address: '127.0.0.1', port: 0 }, () => {
      const { port } = s.address();
      s.close(() => gotowe(port));
    });
  });
}
