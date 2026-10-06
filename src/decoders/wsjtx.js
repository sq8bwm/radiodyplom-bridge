// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Dekoder rodziny WSJT-X: binarny QDataStream (WSJT-X, JTDX >=2.2.158, MSHV).
// Nagłówek: magic 0xADBCCBDA (quint32) | schema (quint32) | type (quint32) | id (utf8)
// Czytamy DWA typy komunikatu o zalogowanej łączności:
//   typ 5  „QSO Logged"   — pola binarne, tak było od początku,
//   typ 12 „Logged ADIF"  — pełny rekord ADIF w jednym polu tekstowym.
//
// Typ 12 dołożony 2026-10-06. Powód: w oknie Network Configuration MSHV ma dwa
// osobne przełączniki — „Enable Logged QSO ADIF" (typ 12) i „Enable Logged QSO"
// (podpowiedź programu mówi przy nim „Logger32, etc."). U Marka zaznaczony był
// tylko ten pierwszy, a my czytaliśmy wyłącznie typ 5, więc takie QSO lądowało
// w koszu — cicho, bo to tylko wpis w logu na poziomie debug.
//
// CZEGO NIE WIEMY: nie przechwyciliśmy od MSHV ŻADNEJ zalogowanej łączności,
// tylko heartbeaty. Nie wiadomo więc, co dokładnie wysyła w którym trybie —
// w szczególności, czy „Enable Logged QSO" to nasz typ 5, czy coś dla Logger32.
// Do sprawdzenia przy pierwszej prawdziwej łączności (MSHV loguje sam, nie ma
// ręcznego zapisu). Bajty niżej pochodzą z WSJT-X, nie z MSHV.
//
// WSJT-X wysyła OBA naraz i to nie grozi podwójnym QSO: dają ten sam odcisk
// treści, więc drugi wpada w deduplikację. Sprawdzone na przechwyconej parze
// z jednego kliknięcia „Log QSO" (test/wsjtx-logged-adif.test.js).
import { bandFromHz, bandFromMHz } from '../bands.js';
import { normalizeMode } from '../modes.js';
import { qsoKey } from '../dedupkey.js';
import { parseAdif, koniecRekordu } from '../adif.js';

export const name = 'WSJT-X';

const MAGIC = 0xadbccbda;
const TYPE_QSO_LOGGED = 5;
const TYPE_LOGGED_ADIF = 12;

export function detect(buf) {
  return buf.length >= 4 && buf.readUInt32BE(0) === MAGIC;
}

/** Czytnik strumienia Qt (big-endian). */
class Reader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }
  _need(n) {
    if (this.pos + n > this.buf.length) throw new Error('koniec datagramu');
  }
  uint32() { this._need(4); const v = this.buf.readUInt32BE(this.pos); this.pos += 4; return v; }
  int32() { this._need(4); const v = this.buf.readInt32BE(this.pos); this.pos += 4; return v; }
  int8() { this._need(1); const v = this.buf.readInt8(this.pos); this.pos += 1; return v; }
  uint64() { this._need(8); const v = this.buf.readBigUInt64BE(this.pos); this.pos += 8; return v; }
  int64() { this._need(8); const v = this.buf.readBigInt64BE(this.pos); this.pos += 8; return v; }

  /** QString/QByteArray w utf8: quint32 długość (0xFFFFFFFF = null) + bajty. */
  utf8() {
    const len = this.uint32();
    if (len === 0xffffffff) return '';
    this._need(len);
    const s = this.buf.toString('utf8', this.pos, this.pos + len);
    this.pos += len;
    return s;
  }

  /** QDateTime: qint64 julian day | quint32 ms od północy | qint8 timespec [| qint32 offset] */
  dateTime() {
    const jd = Number(this.int64());
    const msecs = this.uint32();
    const spec = this.int8();
    if (spec === 2) this.int32(); // OffsetFromUTC – offset w sekundach
    return { jd, msecs, spec };
  }
}

/** Julian Day Number → {year, month, day} (Explanatory Supplement). */
function jdToYmd(jd) {
  const a = jd + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    day: e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year: 100 * b + d - 4800 + Math.floor(m / 10),
  };
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

function formatDateTime(dt) {
  if (!dt || !Number.isFinite(dt.jd) || dt.jd <= 0) return {};
  const { year, month, day } = jdToYmd(dt.jd);
  const totalSec = Math.floor(dt.msecs / 1000);
  const h = Math.floor(totalSec / 3600);
  const mi = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return {
    qso_date: `${year}${pad(month)}${pad(day)}`,
    time_on: `${pad(h)}${pad(mi)}${pad(s)}`,
  };
}

/**
 * Typ 12 „Logged ADIF": jedno pole tekstowe z PEŁNYM plikiem ADIF — nagłówkiem
 * (`<adif_ver>`, `<programid>`, `<eoh>`) i jednym rekordem za nim.
 *
 * Nagłówek trzeba pominąć, inaczej parser zatrzyma się na `<eoh>` i zwróci
 * wersję formatu zamiast łączności (sprawdzone na prawdziwym datagramie —
 * wychodziło `{adif_ver, programid}` i ani jednego pola QSO).
 *
 * `<programid>` zostawiamy w `meta.program`: to jedyne miejsce w tej rodzinie,
 * gdzie program podaje swoją nazwę w samej treści.
 */
function zLoggedAdif(r, clientId) {
  const tekst = r.utf8();
  const granica = koniecRekordu(tekst);
  const naglowek = granica?.naglowek ? parseAdif(tekst.slice(0, granica.koniec)) : {};
  const adif = parseAdif(granica?.naglowek ? tekst.slice(granica.koniec) : tekst);

  if (!adif.call) return null;
  adif.call = adif.call.toUpperCase();
  if (adif.station_callsign) adif.station_callsign = adif.station_callsign.toUpperCase();
  adif.operator = (adif.operator || adif.station_callsign || '').toUpperCase();
  if (adif.mode) adif.mode = normalizeMode(adif.mode);

  // Pasmo bywa puste (WSJT-X bez podłączonego radia wysyła `<band:0>`), więc
  // liczymy je z częstotliwości — tak samo jak przy typie 5.
  if (!adif.band) {
    const z = bandFromMHz(Number(adif.freq));
    if (z) adif.band = z; else delete adif.band;
  }

  return {
    key: qsoKey('wsjtx', null, adif),
    adif,
    meta: { source: 'WSJT-X', client: clientId, program: naglowek.programid || undefined },
  };
}

export function decode(buf) {
  let r;
  try {
    r = new Reader(buf);
    r.uint32();                 // magic (już sprawdzony w detect)
    r.uint32();                 // schema
    const type = r.uint32();
    const clientId = r.utf8();  // np. "WSJT-X" – identyfikuje aplikację, nie QSO

    if (type === TYPE_LOGGED_ADIF) return zLoggedAdif(r, clientId);

    if (type !== TYPE_QSO_LOGGED) {
      return { skip: `typ ${type} (nie QSO Logged ani Logged ADIF)` };
    }

    const dateOff = r.dateTime();
    const dxCall = r.utf8().toUpperCase();
    const dxGrid = r.utf8();
    const txFreqHz = Number(r.uint64());
    const mode = r.utf8();
    const reportSent = r.utf8();
    const reportRecv = r.utf8();
    r.utf8();                   // Tx power – nieużywane
    const comments = r.utf8();
    const opName = r.utf8();
    const dateOn = r.dateTime();
    const opCall = r.utf8().toUpperCase();
    const myCall = r.utf8().toUpperCase();
    const myGrid = r.utf8();

    if (!dxCall) return null;

    // Czas: preferujemy "Date & Time On", z fallbackiem na "Off".
    const when = formatDateTime(dateOn).qso_date ? formatDateTime(dateOn) : formatDateTime(dateOff);

    const adif = {
      call: dxCall,
      qso_date: when.qso_date,
      time_on: when.time_on,
      mode: normalizeMode(mode),
      rst_sent: reportSent,
      rst_rcvd: reportRecv,
      station_callsign: myCall,
      operator: opCall || myCall,
      gridsquare: dxGrid,
      comment: comments,
      name: opName,
      my_gridsquare: myGrid,
    };

    const band = bandFromHz(txFreqHz);
    if (band) adif.band = band;
    if (txFreqHz > 0) adif.freq = (txFreqHz / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');

    // WSJT-X nie ma identyfikatora QSO ("Id" to nazwa klienta), więc zostaje
    // sam odcisk treści.
    const key = qsoKey('wsjtx', null, adif);

    return { key, adif, meta: { source: 'WSJT-X', client: clientId } };
  } catch (err) {
    return { error: `uszkodzony datagram WSJT-X: ${err.message}` };
  }
}
