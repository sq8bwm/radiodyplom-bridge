// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Generyczny nasłuch UDP: rozpoznaje format datagramu i przekazuje go
// właściwemu dekoderowi. Obsługuje mieszane źródła na jednym porcie.
import dgram from 'node:dgram';
import { DECODER_NAMES } from './decoders/index.js';
import { QsoPipeline } from './qso-pipeline.js';
import { log } from './log.js';
import { acquireLock, releaseLock, udpLockPath } from './lock.js';

export class LoggerListener {
  constructor({ host, port, multicastGroups, operations, pin, targets, onQSO, pipeline }) {
    this.host = host;
    this.port = port;
    this.multicastGroups = multicastGroups || [];
    // Potok może być WSPÓLNY z nasłuchem TCP — wtedy liczniki są jedną sumą,
    // a nie dwiema osobnymi. Bez podanego tworzymy własny (tak działają testy
    // i każde użycie sprzed dołożenia Logger32).
    this.pipeline = pipeline || new QsoPipeline({ operations, pin, targets, onQSO });
    this.socket = null;
  }

  /** Liczniki są w potoku; zostawiamy `stats` tam, gdzie ich szukają okno i API. */
  get stats() { return this.pipeline.stats; }

  // Lista celów, PIN i operacje też mieszkają w POTOKU — tym samym, który
  // obsługuje nasłuch TCP. Bez tych akcesorów `applyConfig` przypisywał je do
  // własności nasłuchu, których od wydzielenia potoku (0.1.32) już nie ma:
  // plik na dysku się zmieniał, okno mówiło „zastosowano", a QSO leciały dalej
  // wedle ustawień sprzed zapisu — aż do restartu. Zgłoszone 2026-10-01:
  // wyłączone cele wciąż dostawały kopie.
  get targets() { return this.pipeline.targets; }

  set targets(v) { this.pipeline.targets = v || []; }

  get pin() { return this.pipeline.pin; }

  set pin(v) { this.pipeline.pin = v; }

  get operations() { return this.pipeline.operations; }

  set operations(v) {
    this.pipeline.operations = v instanceof Set ? v : new Set(v || ['insert']);
  }

  /** Zostaje dla zgodności: testy i stary kod wołają `_handle(buf, rinfo)`. */
  _handle(buf, rinfo) {
    this.pipeline.handle(buf, `${rinfo.address}:${rinfo.port}`);
  }

  start() {
    // reuseAddr jest potrzebny do multicastu, gdzie KAŻDY słuchacz dostaje
    // własną kopię datagramu. Przy unicaście współistnienia nie ma: datagram
    // trafia do jednego gniazda (zmierzone: do tego, które zbindowało się
    // później). Skutkiem ubocznym jest to, że dwie nasze instancje też zajmą
    // ten port — i jedna odbierałaby QSO drugiej. Stąd własna blokada.
    this.portLock = udpLockPath(this.host, this.port);
    acquireLock(
      this.portLock,
      `Port UDP ${this.host}:${this.port}`,
      'Dwa mostki na jednym porcie dzieliłyby między siebie QSO, część by przepadła. '
      + 'Zamknij tamtą instancję albo zmień udp.port.',
    );

    return new Promise((resolve, reject) => {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.socket.on('error', (err) => {
        log.error('Błąd socketu UDP', err.message);
        reject(err);
      });
      this.socket.on('message', (buf, rinfo) => this._handle(buf, rinfo));
      this.socket.bind(this.port, this.host, () => {
        log.info(`Nasłuchuję na udp://${this.host}:${this.port}`, { dekodery: DECODER_NAMES });

        if (this.host === '127.0.0.1') {
          log.info('Bind na localhost – odbieram tylko z tej maszyny. '
            + 'Dla loggera na innym komputerze lub wysyłki rozgłoszeniowej ustaw udp.host na "0.0.0.0".');
        }

        // Multicast (np. WSJT-X potrafi nadawać na 224.0.0.222).
        // Grupy da się dołączyć tylko przy bindzie na wszystkie interfejsy.
        for (const g of this.multicastGroups) {
          try {
            this.socket.addMembership(g);
            log.info(`Dołączono do grupy multicast ${g}`);
          } catch (err) {
            log.warn(`Nie mogę dołączyć do grupy multicast ${g} – ${err.message}`
              + (this.host !== '0.0.0.0' ? ' (wymaga udp.host = "0.0.0.0")' : ''));
          }
        }
        resolve();
      });
    });
  }

  stop() {
    if (this.socket) {
      try { this.socket.close(); } catch { /* już zamknięty */ }
      this.socket = null;
    }
    releaseLock(this.portLock);
  }
}
