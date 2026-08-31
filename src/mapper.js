// Mapowanie pól ADIF (z QLog) na format oczekiwany przez qso_upload.php.

// ADIF → radiodyplom
const FIELD_MAP = {
  call: 'callsign',
  qso_date: 'qso_date',
  time_on: 'time_on',
  band: 'band',
  mode: 'mode',
  rst_sent: 'report_sent',
  rst_rcvd: 'report_received',
  station_callsign: 'station_callsign',
  operator: 'operator',
  freq: 'freq',
  gridsquare: 'gridsquare',
  comment: 'comment',
  name: 'name',
  qth: 'qth',
};

// Pola wymagane przez serwer (potwierdzone komunikatem INVALID_QSO_DATA).
const REQUIRED = ['callsign', 'qso_date', 'station_callsign'];

// Znaki i emisję normalizujemy do wielkich liter; pasmo NIE – konwencja ADIF to "40m".
const UPPER = new Set(['callsign', 'station_callsign', 'operator', 'mode']);

/**
 * @param {object} adif  wynik parseAdif()
 * @param {string} pin   PIN/klucz API radiodyplom
 * @returns {{ok:true, payload:object} | {ok:false, missing:string[]}}
 */
export function mapToRadiodyplom(adif, pin) {
  const payload = { api_key: pin };

  for (const [src, dst] of Object.entries(FIELD_MAP)) {
    let v = adif[src];
    if (v == null) continue;
    v = String(v).trim();
    if (v === '') continue;
    payload[dst] = UPPER.has(dst) ? v.toUpperCase() : v;
  }

  const missing = REQUIRED.filter((k) => !payload[k]);
  if (missing.length) return { ok: false, missing };

  return { ok: true, payload };
}
