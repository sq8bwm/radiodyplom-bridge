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
export function decode(buf) {
  const tekst = buf.toString('utf8');
  const adif = parseAdif(tekst);

  // Sam nagłówek pliku ADIF (`<adif_ver:5>3.1.4<eoh>`) nie jest QSO.
  if (!adif.call) return null;

  return {
    // Logger32 nie podaje żadnego identyfikatora rekordu, więc — jak przy
    // WSJT-X — klucz opiera się wyłącznie na odcisku treści. Ponowne
    // zalogowanie tej samej łączności da ten sam klucz, czyli duplikat
    // zostanie rozpoznany.
    key: qsoKey('logger32', null, adif),
    adif,
    meta: { source: name },
  };
}
