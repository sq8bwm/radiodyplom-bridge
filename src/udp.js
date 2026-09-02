// Generyczny nasłuch UDP: rozpoznaje format datagramu i przekazuje go
// właściwemu dekoderowi. Obsługuje mieszane źródła na jednym porcie.
import dgram from 'node:dgram';
import { pickDecoder, DECODER_NAMES } from './decoders/index.js';
import { mapToRadiodyplom } from './mapper.js';
import { expandTargets } from './fanout.js';
import { log } from './log.js';
import { acquireLock, releaseLock, udpLockPath } from './lock.js';

export class LoggerListener {
  constructor({ host, port, multicastGroups, operations, pin, targets, operators, onQSO }) {
    this.host = host;
    this.port = port;
    this.multicastGroups = multicastGroups || [];
    this.operations = new Set(operations || ['insert']);
    this.pin = pin;
    this.targets = targets || [];
    this.operators = operators || [];
    this.onQSO = onQSO;
    this.socket = null;
    this.stats = { received: 0, accepted: 0, skipped: 0, invalid: 0, unknown: 0, bySource: {} };
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

  _handle(buf, rinfo) {
    this.stats.received++;

    const decoder = pickDecoder(buf);
    if (!decoder) {
      this.stats.unknown++;
      log.warn(`Nieznany format datagramu z ${rinfo.address}:${rinfo.port}`, {
        bytes: buf.length, head: buf.subarray(0, 8).toString('hex'),
      });
      return;
    }

    let result;
    try {
      result = decoder.decode(buf, { operations: this.operations });
    } catch (err) {
      this.stats.invalid++;
      log.warn(`Dekoder ${decoder.name} rzucił błąd`, err.message);
      return;
    }

    if (!result) {
      this.stats.invalid++;
      log.debug(`Dekoder ${decoder.name}: datagram nieprzydatny`);
      return;
    }
    if (result.skip) {
      this.stats.skipped++;
      log.debug(`Dekoder ${decoder.name}: pomijam – ${result.skip}`);
      return;
    }
    if (result.error) {
      this.stats.invalid++;
      log.warn(`Dekoder ${decoder.name}: ${result.error}`);
      return;
    }

    const mapped = mapToRadiodyplom(result.adif, this.pin);
    if (!mapped.ok) {
      this.stats.invalid++;
      log.warn(`QSO z ${decoder.name} bez wymaganych pól – pomijam`, {
        missing: mapped.missing, call: result.adif.call,
      });
      return;
    }

    this.stats.accepted++;
    this.stats.bySource[decoder.name] = (this.stats.bySource[decoder.name] || 0) + 1;

    // Jedno QSO z loggera może dać kilka wpisów – po jednym na znak stacji.
    const copies = expandTargets(mapped.payload, this.targets, result.key);
    for (const c of copies) {
      this.onQSO({
        key: c.key,
        payload: c.payload,
        meta: {
          ...result.meta,
          station: c.station,
          // Znacznik dla workera: PIN tej kopii pochodzi wprost z konfiguracji
          // celu, więc baza operatorów nie ma go nadpisywać.
          pinExplicit: c.pinExplicit,
          fanout: copies.length > 1 ? `${copies.length} kopii` : undefined,
          from: `${rinfo.address}:${rinfo.port}`,
        },
      });
    }
  }

  stop() {
    if (this.socket) {
      try { this.socket.close(); } catch { /* już zamknięty */ }
      this.socket = null;
    }
    releaseLock(this.portLock);
  }
}
