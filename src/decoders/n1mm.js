// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Dekoder rodziny N1MM: XML <contactinfo> (N1MM+, DXLog, Log4OM, RUMlogNG).
//
// BBLogger umie OBA: w jego oknie „QSO UDP Broadcast" lista Format ma `ADIF`
// i `XML (N1MM)` (sprawdzone w programie 05.10.2026). Instrukcja jego autorów
// (podłączenie do HamAward) każe wybrać ADIF i słowo „N1MM" nie pada w niej ani
// razu — dlatego nasz dawny wpis „BBlogger = N1MM" był mylący, choć nie fałszywy.
// Uwaga: <rxfreq>/<txfreq> są w jednostkach 10 Hz, a <band> to MHz (np. "3.5"), nie pasmo ADIF.
import { bandFromMHz, czyNazwaPasma, pasmoZawiera } from '../bands.js';
import { normalizeMode } from '../modes.js';
import { qsoKey } from '../dedupkey.js';

export const name = 'N1MM';

/**
 * Częstotliwość w MHz z `<txfreq>`, z uwzględnieniem tego, że JEDNOSTKA NIE JEST
 * JEDNA. Zmierzone 2026-10-05 na przechwyconych datagramach:
 *
 *   N1MM+, DXLog, RUMlogNG → 10 Hz, czyli setne części kHz  (14250,00 kHz = 1425000)
 *   BBLogger               → 100 Hz, czyli dziesiąte kHz     (14250,0 kHz  =  142500)
 *
 * Z samej liczby tego nie rozstrzygniemy i nie wolno zgadywać „to, co wpada
 * w jakieś pasmo": 181000 czytane jako 10 Hz daje 1,81 MHz (160 m — pasmo
 * istnieje!), a naprawdę jest to 18,1 MHz (17 m). Oba warianty są wtedy
 * „sensowne" i wybór po samej liczbie byłby cichym błędem.
 *
 * Rozstrzyga `<band>`: który przelicznik trafia W TO pasmo, ten jest właściwy.
 * Dopiero bez `<band>` zostaje 10 Hz — zachowanie sprzed tej zmiany.
 */
function czestotliwoscMHz(xml) {
  const surowa = Number(tag(xml, 'txfreq'));
  const pasmo = tag(xml, 'band');
  const kandydaci = Number.isFinite(surowa) && surowa > 0
    ? [surowa / 100000, surowa / 10000]
    : [];

  if (czyNazwaPasma(pasmo)) {
    const trafiony = kandydaci.find((m) => pasmoZawiera(pasmo, m));
    if (trafiony) return trafiony;
  }

  const [dziesiecHz] = kandydaci;
  if (Number.isFinite(dziesiecHz) && dziesiecHz > 0) return dziesiecHz;

  // Bez txfreq zostaje samo `<band>`: u N1MM+ to MHz („3.5"), u BBLoggera nazwa
  // pasma („20m") — z nazwy częstotliwości nie wyliczymy, ale pasmo przetrwa niżej.
  const wMhz = Number(pasmo);
  return Number.isFinite(wMhz) && wMhz > 0 ? wMhz : NaN;
}

export function detect(buf) {
  // XML zaczyna się od '<' (deklaracja <?xml ...?> albo wprost <contactinfo>)
  return buf.length > 0 && buf[0] === 0x3c; // '<'
}

function tag(xml, tagName) {
  const m = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'i').exec(xml);
  if (!m) return '';
  return m[1].trim()
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** "2020-01-17 16:43:38" → {qso_date:"20200117", time_on:"164338"} */
function splitTimestamp(ts) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(ts || '');
  if (!m) return {};
  return {
    qso_date: `${m[1]}${m[2]}${m[3]}`,
    time_on: `${m[4]}${m[5]}${m[6] || '00'}`,
  };
}

export function decode(buf) {
  const xml = buf.toString('utf8');

  // Świadomie obsługujemy tylko nowe QSO – zgodnie z decyzją "tylko insert".
  if (!/<contactinfo[\s>]/i.test(xml)) {
    if (/<contact(replace|delete)[\s>]/i.test(xml)) {
      return { skip: 'contactreplace/contactdelete' };
    }
    return null;
  }

  const call = tag(xml, 'call').toUpperCase();
  if (!call) return null;

  const station = (tag(xml, 'mycall') || tag(xml, 'stationprefix')).toUpperCase();
  const operator = tag(xml, 'operator').toUpperCase() || station;
  const { qso_date, time_on } = splitTimestamp(tag(xml, 'timestamp'));

  const mhz = czestotliwoscMHz(xml);

  const adif = {
    call,
    qso_date,
    time_on,
    mode: normalizeMode(tag(xml, 'mode')),
    rst_sent: tag(xml, 'snt'),
    rst_rcvd: tag(xml, 'rcv'),
    station_callsign: station,
    operator,
    gridsquare: tag(xml, 'gridsquare'),
    comment: tag(xml, 'comment'),
    name: tag(xml, 'name'),
    qth: tag(xml, 'qth'),
  };

  // Pasmo najchętniej z częstotliwości, ale gdy jej nie ma, a logger podał
  // gotową nazwę pasma (tak robi BBLogger), nie ma powodu jej wyrzucać.
  const band = bandFromMHz(mhz) || (czyNazwaPasma(tag(xml, 'band')) ? tag(xml, 'band').trim().toLowerCase() : null);
  if (band) adif.band = band;
  if (Number.isFinite(mhz) && mhz > 0) adif.freq = mhz.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');

  // <ID> N1MM plus odcisk treści — tak samo jak w QLog, żeby ewentualne
  // powtórzenie identyfikatora nie kasowało prawdziwego QSO.
  const id = tag(xml, 'ID');
  const key = qsoKey('n1mm', id || null, adif);

  return {
    key,
    adif,
    meta: { source: 'N1MM', app: tag(xml, 'app'), id: id || null },
  };
}

