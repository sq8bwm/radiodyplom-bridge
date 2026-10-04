// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Co się dzieje z odebranym QSO, niezależnie od tego, JAK przyszło.
//
// Rozpoznanie formatu, dekodowanie, mapowanie na pola radiodyplom,
// rozmnożenie na cele i policzenie statystyk są wspólne dla nasłuchu UDP
// (QLog, N1MM, WSJT-X) i TCP (Logger32). Wydzielone tutaj, żeby dołożenie
// drugiego transportu nie znaczyło drugiej kopii tej logiki — a przy okazji
// żeby liczniki w oknie pokazywały jedną sumę, nie dwie.
import { pickDecoder } from './decoders/index.js';
import { mapToRadiodyplom } from './mapper.js';
import { expandTargets } from './fanout.js';
import { log } from './log.js';
import { zapiszNieznany } from './nieznane.js';

export class QsoPipeline {
  constructor({ operations, pin, targets, onQSO, dataDir = null }) {
    this.operations = new Set(operations || ['insert']);
    this.pin = pin;
    this.targets = targets || [];
    this.onQSO = onQSO;
    // Gdzie odkładać nieznane datagramy. null = nie odkładamy (testy jednostkowe).
    this.dataDir = dataDir;
    this.stats = { received: 0, accepted: 0, skipped: 0, invalid: 0, unknown: 0,
      bySource: {}, skipReasons: {},
      // Znak stacji z OSTATNIEGO odebranego QSO — czyli to, czym logujesz
      // w loggerze. Potrzebny, żeby okno mogło powiedzieć, czy któryś włączony
      // cel loguje na ten znak. Bez tego „poleci jako" byłoby listą ustawień,
      // a nie odpowiedzią na pytanie „a czym logujesz teraz".
      lastStation: null };
  }

  /** @param {Buffer} buf  @param {string} skad  opis nadawcy do logów i metadanych */
  handle(buf, skad) {
    this.stats.received++;

    const decoder = pickDecoder(buf);
    if (!decoder) {
      this.stats.unknown++;
      // Osiem bajtów w hex wystarczało, dopóki wszystkie formaty były binarne
      // albo oczywiste. Przy ADIF-ie i XML-u czytelny początek treści mówi
      // znacznie więcej — i to on decyduje, czy da się dopisać dekoder.
      const tekstowy = buf.subarray(0, 120).toString('utf8');
      const czytelny = /^[\t\r\n\x20-\x7e\u00a0-\uffff]*$/.test(tekstowy);
      log.warn(`Nieznany format danych z ${skad}`, {
        bytes: buf.length,
        head: buf.subarray(0, 8).toString('hex'),
        ...(czytelny ? { poczatek: tekstowy.replace(/[\u0000-\u001f]/g, '·') } : {}),
      });
        // Początek w logu wystarcza, żeby ROZPOZNAĆ, że coś przyszło, ale nie
        // wystarcza, żeby napisać dekoder. Całość odkładamy do analizy.
        zapiszNieznany(buf, skad, { dataDir: this.dataDir });
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
      // Powód zliczamy, a nie tylko logujemy. Na poziomie `debug` (bo WSJT-X
      // sypie komunikatami stanu co sekundę i przy `info` zalałby log), więc
      // przy domyślnych ustawieniach użytkownik NIE MIAŁ jak się dowiedzieć,
      // czemu „odebrane z loggera" nie zgadza się ze „źródłami". Pytanie
      // padło 2026-09-04 przy czterech pominiętych datagramach.
      //
      // Liczba różnych powodów jest z natury mała (operacje QLoga, typy
      // komunikatów WSJT-X), ale limit i tak stawiamy — źródło nadające
      // śmieci nie ma prawa rozdąć tego bez końca.
      const powod = String(result.skip);
      if (this.stats.skipReasons[powod] !== undefined) this.stats.skipReasons[powod] += 1;
      else if (Object.keys(this.stats.skipReasons).length < 20) this.stats.skipReasons[powod] = 1;
      log.debug(`Dekoder ${decoder.name}: pomijam – ${powod}`);
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
      // Wypisujemy TAKŻE pola, które przyszły. Bez tego wiadomo tylko, czego
      // brakuje, a nie czym to zastąpić — a przy nowym loggerze to jedyna
      // informacja, która pozwala dopisać obsługę (Logger32, 2026-09-30:
      // brakowało `station_callsign` i nie było wiadomo, co jest zamiast).
      log.warn(`QSO z ${decoder.name} bez wymaganych pól – pomijam`, {
        missing: mapped.missing,
        call: result.adif.call,
        przyszly: Object.keys(result.adif || {}).sort().join(', '),
      });
      return;
    }

    this.stats.accepted++;
    this.stats.bySource[decoder.name] = (this.stats.bySource[decoder.name] || 0) + 1;
    this.stats.lastStation = mapped.payload.station_callsign || null;

    // Jedno QSO z loggera może dać kilka wpisów – po jednym na znak stacji.
    const copies = expandTargets(mapped.payload, this.targets, result.key);
    for (const c of copies) {
      this.onQSO({
        key: c.key,
        payload: c.payload,
        meta: {
          ...result.meta,
          station: c.station,
          fanout: copies.length > 1 ? `${copies.length} kopii` : undefined,
          from: skad,
        },
      });
    }
  }

}
