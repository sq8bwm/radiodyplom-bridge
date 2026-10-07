// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Dekoder ADIF: goły rekord ADIF, bez opakowania.
//
// NAZWA. Dekoder nazywa się ADIF, a nie Logger32, bo ADIF jest formatem
// WYMIANY, nie formatem jednego programu — przysyła go też BBLogger i każdy
// skrypt, który potrafi złożyć rekord. Nazwa programu w kolumnie Źródła
// kłamałaby użytkownikowi innego loggera: widziałby QSO przypisane do czegoś,
// czego nie ma na dysku. Tak samo nazywa się dekoder N1MM — formatem, którym
// mówi do nas kilka programów naraz.
//
// Prefiks deduplikacji ZOSTAJE `logger32`: siedzi w kluczach QSO już wysłanych,
// a zmiana rozsypałaby je na nowe i wysłała drugi raz.
//
// Logger32 (od 4.0.344) ma „enable QSO export by TCP": jako KLIENT TCP łączy
// się pod wskazany adres i port i wysyła każde zalogowane QSO w ADIF-ie.
// Nie rozgłasza nic po UDP — dlatego samo dołożenie dekodera nie wystarczyło,
// trzeba było dołożyć nasłuch TCP (src/tcp.js).
//
// Dekoder jest oddzielony od transportu celowo: ten sam ADIF przyjmiemy też
// datagramem UDP, gdyby ktoś podał go skryptem.
import { parseAdif } from '../adif.js';
import { modeZRekordu, rodzinaEmisji } from '../modes.js';
import { normalizujPasmo } from '../bands.js';
import { qsoKey } from '../dedupkey.js';
import { log } from '../log.js';

export const name = 'ADIF';

/**
 * ADIF poznajemy po tagu z DEKLAROWANĄ DŁUGOŚCIĄ: `<call:6>`.
 *
 * To odróżnia go od XML-a N1MM (`<contactinfo>`, `<?xml`), który też zaczyna
 * się od „<", a jest sprawdzany zaraz po nas. Nagłówek ADIF-a bywa poprzedzony
 * zwykłym tekstem, więc szukamy w pierwszych 300 znakach, nie tylko na początku.
 */
export function detect(buf) {
  if (!buf || buf.length === 0) return false;
  const head = buf.subarray(0, 300).toString('utf8');
  return /<[A-Za-z0-9_]+:\d+(?::[A-Za-z])?>/.test(head);
}

/**
 * @returns {{key:string, adif:object, meta:object} | {skip:string} | null}
 */
/** Kogo już uprzedziliśmy o podstawieniu znaku — żeby nie powtarzać przy każdym QSO. */
const uprzedzeni = new Set();

export function decode(buf) {
  const tekst = buf.toString('utf8');
  let adif = parseAdif(tekst);

  // KOPERTA JTDX. Logger32 wysyła po TCP goły rekord (sprawdzone na żywym
  // programie 30.09.2026), ale JTDX w `Settings → Reporting → Enable sending to
  // TCP server` opakowuje ten sam ADIF w dwa pola:
  //
  //   <command:3>Log <parameters:248> <BAND:3>20m …<EOR>
  //
  // Parser czyta wtedy poprawnie `command` i `parameters`, ale na wierzchu nie
  // ma `call`, więc rekord odpadał niżej jako „to nie QSO" — BEZ ŻADNEGO WPISU
  // W LOGU, bo dekoder jest rozpoznany i tylko zwraca null. Zmierzone 07.10.2026
  // na JTDX 2.2.159: QSO ginęło po cichu.
  //
  // Rozpakowujemy tylko wtedy, gdy na wierzchu NIE MA znaku, a `parameters`
  // jest — więc dla gołego rekordu Logger32 ta gałąź się nie uruchamia.
  if (!adif.call && adif.parameters) {
    adif = parseAdif(adif.parameters);
  }

  // Emisja i pasmo ujednolicone jak w pozostałych dekoderach: SUBMODE ma
  // pierwszeństwo (ADIF trzyma FT4 jako MODE=MFSK + SUBMODE=FT4), a pasmo idzie
  // małymi literami. Bez tego ta sama łączność z dwóch źródeł ma różny odcisk
  // treści — a na tym stoi deduplikacja.
  const emisja = modeZRekordu(adif);
  const rodzina = rodzinaEmisji(adif);
  if (emisja) adif.mode = emisja;
  delete adif.submode;
  if (adif.band) adif.band = normalizujPasmo(adif.band);

  // Sam nagłówek pliku ADIF (`<adif_ver:5>3.1.4<eoh>`) nie jest QSO.
  if (!adif.call) return null;

  // LOGGER32 NIE WYSYŁA `station_callsign` — sprawdzone na żywym programie
  // 2026-09-30. W jego rekordzie znak, pod którym pracujemy, siedzi w polu
  // OPERATOR (tu: SQ8BWM), a radiodyplom sprawdza właśnie znak stacji.
  // Bez tego podstawienia każde QSO z Logger32 odpadało z komunikatem
  // „bez wymaganych pól".
  let zOperatora = false;
  if (!adif.station_callsign && adif.operator) {
    adif.station_callsign = adif.operator;
    zOperatora = true;
    const znak = String(adif.operator).toUpperCase();
    if (!uprzedzeni.has(znak)) {
      uprzedzeni.add(znak);
      // Rzecz zmienia przypisanie QSO do stacji, więc musi być widoczna —
      // ale raz na znak, nie przy każdej łączności.
      log.info(`Logger32 nie podaje znaku stacji; biorę go z pola OPERATOR: ${znak}. `
        + 'Jeśli pracujesz pod innym znakiem, dopisz go w „Rozmnażanie QSO na wiele stacji".');
    }
  }

  return {
    // Logger32 numeruje QSO własnym polem APP_LOGGER32_QSO_NUMBER. Używamy go
    // razem z odciskiem treści (jak przy QLogu), a gdy go nie ma — samej treści
    // (jak przy WSJT-X).
    key: qsoKey('logger32', adif.app_logger32_qso_number || null, adif),
    adif,
    meta: {
      source: name,
      ...(zOperatora ? { stacjaZOperatora: true } : {}),
      // Zapas na wypadek INVALID_MODE — patrz rodzinaEmisji() w src/modes.js.
      modeRodzina: rodzina || undefined,
    },
  };
}
