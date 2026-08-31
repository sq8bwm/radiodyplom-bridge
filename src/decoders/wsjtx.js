// Dekoder rodziny WSJT-X: binarny QDataStream (WSJT-X, JTDX >=2.2.158, MSHV).
// Nagłówek: magic 0xADBCCBDA (quint32) | schema (quint32) | type (quint32) | id (utf8)
// Interesuje nas typ 5 = "QSO Logged" (wysyłany po zatwierdzeniu okna Log QSO).
import { createHash } from 'node:crypto';
import { bandFromHz } from '../bands.js';
import { normalizeMode } from '../modes.js';

export const name = 'WSJT-X';

const MAGIC = 0xadbccbda;
const TYPE_QSO_LOGGED = 5;

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

export function decode(buf) {
  let r;
  try {
    r = new Reader(buf);
    r.uint32();                 // magic (już sprawdzony w detect)
    r.uint32();                 // schema
    const type = r.uint32();
    const clientId = r.utf8();  // np. "WSJT-X" – identyfikuje aplikację, nie QSO

    if (type !== TYPE_QSO_LOGGED) {
      return { skip: `typ ${type} (nie QSO Logged)` };
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

    // WSJT-X nie ma identyfikatora QSO (jego "Id" to nazwa klienta),
    // więc klucz deduplikacji musi być syntetyczny.
    const basis = [adif.call, adif.qso_date, adif.time_on, adif.band, adif.mode, adif.station_callsign].join('|');
    const key = `wsjtx:${createHash('sha1').update(basis).digest('hex').slice(0, 16)}`;

    return { key, adif, meta: { source: 'WSJT-X', client: clientId } };
  } catch (err) {
    return { error: `uszkodzony datagram WSJT-X: ${err.message}` };
  }
}
