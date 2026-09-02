// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Dekoder rodziny N1MM: XML <contactinfo> (N1MM+, DXLog, BBlogger, Log4OM w trybie N1MM).
// Uwaga: <rxfreq>/<txfreq> są w jednostkach 10 Hz, a <band> to MHz (np. "3.5"), nie pasmo ADIF.
import { bandFromMHz } from '../bands.js';
import { normalizeMode } from '../modes.js';
import { qsoKey } from '../dedupkey.js';

export const name = 'N1MM';

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

  // txfreq w jednostkach 10 Hz → MHz
  const txfreqRaw = Number(tag(xml, 'txfreq'));
  let mhz = Number.isFinite(txfreqRaw) && txfreqRaw > 0 ? txfreqRaw / 100000 : NaN;
  // fallback: <band> podaje MHz (np. "3.5")
  if (!Number.isFinite(mhz) || mhz <= 0) {
    const b = Number(tag(xml, 'band'));
    if (Number.isFinite(b) && b > 0) mhz = b;
  }

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

  const band = bandFromMHz(mhz);
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

