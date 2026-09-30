// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Dekoder Logger32: goły rekord ADIF.
//
// Logger32 (od 4.0.344) ma „enable QSO export by TCP": jako KLIENT TCP łączy
// się pod wskazany adres i port i wysyła każde zalogowane QSO w ADIF-ie.
// Nie rozgłasza nic po UDP — dlatego samo dołożenie dekodera nie wystarczyło,
// trzeba było dołożyć nasłuch TCP (src/tcp.js).
//
// Dekoder jest oddzielony od transportu celowo: ten sam ADIF przyjmiemy też
// datagramem UDP, gdyby ktoś podał go skryptem.
import { parseAdif } from '../adif.js';
import { qsoKey } from '../dedupkey.js';
import { log } from '../log.js';

export const name = 'Logger32';

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
  const adif = parseAdif(tekst);

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
    meta: { source: name, ...(zOperatora ? { stacjaZOperatora: true } : {}) },
  };
}
