// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Nasłuch TCP dla Logger32.
//
// Logger32 (od 4.0.344) nie rozgłasza QSO po UDP jak pozostałe loggery. Ma
// „enable QSO export by TCP": sam, jako KLIENT, łączy się pod wskazany adres
// i port (domyślnie 52005) i wysyła zalogowane QSO w ADIF-ie. Z działającego
// wdrożenia (Node-RED, węzeł `tcp in` w trybie `single`) wynika, że robi to
// per QSO: otwiera połączenie, wysyła rekord, zamyka.
//
// Dlatego czytamy strumień na DWA sposoby naraz:
//   1. na bieżąco, gdy tylko w buforze pojawi się kompletny rekord (`<eor>`),
//   2. przy zamknięciu połączenia — bo gdyby Logger32 nie dopisał `<eor>`,
//      QSO przepadłoby bez śladu, a to jedyna rzecz, której temu programowi
//      robić nie wolno.
//
// Dekodowanie i reszta drogi są wspólne z UDP (QsoPipeline), więc Logger32
// dostaje dokładnie to samo: rozgałęzianie na kilka znaków stacji, kolejkę
// przeżywającą restart i te same liczniki w oknie.
import net from 'node:net';
import { koniecRekordu } from './adif.js';
import { log } from './log.js';

/** Ile najwyżej połączeń naraz. Logger32 trzyma jedno; reszta to pomyłka albo skan. */
const MAX_POLACZEN = 8;

/** Górna granica jednego rekordu. ADIF QSO ma setki bajtów, nie megabajty. */
const LIMIT_BAJTOW = 256 * 1024;

/** Po tylu minutach ciszy zamykamy połączenie — żeby nie zostawały wiszące. */
const CISZA_MS = 10 * 60 * 1000;

export class Logger32Listener {
  constructor({ host, port, pipeline }) {
    this.host = host;
    this.port = port;
    this.pipeline = pipeline;
    this.server = null;
    this.polaczenia = new Set();
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this._polaczenie(socket));

      this.server.on('error', (err) => {
        // Bind TCP jest wyłączny, więc zajęty port zgłasza się sam — ale
        // komunikat systemowy („EADDRINUSE") nie mówi, co z tym zrobić.
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port TCP ${this.host}:${this.port} jest już zajęty. `
            + 'Zamknij program, który go trzyma, albo zmień tcp.port '
            + '(i to samo ustawienie w Logger32).'));
          return;
        }
        log.error('Błąd nasłuchu TCP', err.message);
        reject(err);
      });

      this.server.listen(this.port, this.host, () => {
        log.info(`Nasłuchuję na tcp://${this.host}:${this.port} (Logger32)`);
        if (this.host === '127.0.0.1') {
          log.info('Nasłuch TCP tylko na localhost. Jeśli Logger32 działa na innym '
            + 'komputerze, ustaw tcp.host na "0.0.0.0" i wskaż w nim adres tej maszyny.');
        }
        resolve();
      });
    });
  }

  _polaczenie(socket) {
    const skad = `${socket.remoteAddress}:${socket.remotePort} (TCP)`;

    if (this.polaczenia.size >= MAX_POLACZEN) {
      log.warn(`Odrzucam połączenie TCP z ${skad} — już ${this.polaczenia.size} otwartych`);
      socket.destroy();
      return;
    }
    this.polaczenia.add(socket);
    socket.setTimeout(CISZA_MS, () => socket.destroy());

    let bufor = '';
    let zaDuzo = false;

    socket.on('data', (kawalek) => {
      if (zaDuzo) return;
      bufor += kawalek.toString('utf8');
      if (bufor.length > LIMIT_BAJTOW) {
        zaDuzo = true;
        log.warn(`Połączenie TCP z ${skad} przysłało ponad ${LIMIT_BAJTOW} B bez `
          + 'kompletnego rekordu ADIF — zamykam');
        socket.destroy();
        return;
      }
      bufor = this._wytnijGotowe(bufor, skad);
    });

    const domknij = () => {
      // Reszta bez `<eor>`: Logger32 zamyka połączenie po każdym QSO, więc
      // brak znacznika końca nie znaczy „niekompletne", tylko „to już wszystko".
      const reszta = bufor.trim();
      bufor = '';
      if (reszta && /<[A-Za-z0-9_]+:\d+/.test(reszta)) {
        this.pipeline.handle(Buffer.from(reszta, 'utf8'), skad);
      }
      this.polaczenia.delete(socket);
    };

    socket.on('end', domknij);
    socket.on('close', () => this.polaczenia.delete(socket));
    socket.on('error', (err) => {
      log.debug(`Połączenie TCP z ${skad}: ${err.message}`);
      this.polaczenia.delete(socket);
    });
  }

  /** Oddaje potokowi każdy kompletny rekord z bufora, zwraca resztę. */
  _wytnijGotowe(bufor, skad) {
    let reszta = bufor;
    for (;;) {
      const koniec = koniecRekordu(reszta);
      if (!koniec) return reszta;
      const rekord = reszta.slice(0, koniec.koniec);
      reszta = reszta.slice(koniec.koniec);
      // Nagłówek pliku ADIF (`…<eoh>`) nie jest QSO — pomijamy bez hałasu.
      if (!koniec.naglowek) {
        this.pipeline.handle(Buffer.from(rekord, 'utf8'), skad);
      }
    }
  }

  stop() {
    for (const s of this.polaczenia) {
      try { s.destroy(); } catch { /* już zamknięte */ }
    }
    this.polaczenia.clear();
    if (this.server) {
      try { this.server.close(); } catch { /* już zamknięty */ }
      this.server = null;
    }
  }
}
