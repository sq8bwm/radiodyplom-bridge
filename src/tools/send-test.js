#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Generator syntetycznych datagramów – test dekoderów bez prawdziwego loggera.
//   npm run send-test -- SP9TEST 40m SSB                 (domyślnie QLog)
//   npm run send-test -- SP9TEST 40m SSB --format n1mm
//   npm run send-test -- SP9TEST 20m FT8 --format wsjtx
import dgram from 'node:dgram';
import { loadConfig } from '../config.js';

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) { i++; continue; }
  positional.push(args[i]);
}

const call = (positional[0] || 'SP9TEST').toUpperCase();
const band = positional[1] || '40m';
const mode = (positional[2] || 'SSB').toUpperCase();
const station = flag('station', 'SQ8BWM').toUpperCase();
const operator = flag('operator', station).toUpperCase();
const format = flag('format', 'qlog').toLowerCase();
const rowid = Number(flag('rowid', String(Math.floor(Math.random() * 1e6))));

// Reprezentatywna częstotliwość dla pasma (potrzebna dla N1MM/WSJT-X).
const BAND_FREQ_MHZ = {
  '160m': 1.840, '80m': 3.700, '40m': 7.140, '30m': 10.120, '20m': 14.200,
  '17m': 18.130, '15m': 21.250, '12m': 24.950, '10m': 28.400,
  '6m': 50.150, '2m': 145.500, '70cm': 433.500,
};
const mhz = Number(flag('mhz', String(BAND_FREQ_MHZ[band] || 7.140)));

const now = new Date();
const pad = (n, w = 2) => String(n).padStart(w, '0');
const Y = now.getUTCFullYear(), M = now.getUTCMonth() + 1, D = now.getUTCDate();
const h = now.getUTCHours(), mi = now.getUTCMinutes(), s = now.getUTCSeconds();
const qsoDate = `${Y}${pad(M)}${pad(D)}`;
const timeOn = `${pad(h)}${pad(mi)}${pad(s)}`;

// ---------- QLog: JSON + rekord ADIF ----------
function buildQLog() {
  const t = (n, v, type) => {
    const x = String(v);
    return `<${n}:${x.length}${type ? ':' + type : ''}>${x}`;
  };
  const adif = [
    t('call', call), t('qso_date', qsoDate, 'D'), t('time_on', timeOn, 'T'),
    t('rst_sent', '59'), t('rst_rcvd', '59'), t('band', band), t('mode', mode),
    t('freq', mhz.toFixed(5), 'N'),
    t('operator', operator), t('station_callsign', station), t('comment', 'test bridge'),
    '<eor>',
  ].join('');
  return Buffer.from(JSON.stringify({
    appid: 'QLog', msgtype: 'qso', time: Date.now(),
    logid: '{ce69e12f-8d3e-453e-a170-bce574be0d67}',
    data: { operation: 'insert', rowid, type: 'adif', value: adif },
  }));
}

// ---------- N1MM: XML <contactinfo>, txfreq w jednostkach 10 Hz ----------
function buildN1MM() {
  const txfreq = Math.round(mhz * 100000); // MHz → jednostki 10 Hz
  const n1mmMode = mode === 'SSB' ? 'USB' : mode;
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<contactinfo>
	<app>N1MM</app>
	<timestamp>${Y}-${pad(M)}-${pad(D)} ${pad(h)}:${pad(mi)}:${pad(s)}</timestamp>
	<mycall>${station}</mycall>
	<band>${mhz}</band>
	<rxfreq>${txfreq}</rxfreq>
	<txfreq>${txfreq}</txfreq>
	<operator>${operator}</operator>
	<mode>${n1mmMode}</mode>
	<call>${call}</call>
	<snt>59</snt>
	<rcv>59</rcv>
	<gridsquare>JO90</gridsquare>
	<comment>test bridge</comment>
	<ID>${'t'.repeat(4)}${rowid}</ID>
</contactinfo>`;
  return Buffer.from(xml, 'utf8');
}

// ---------- WSJT-X: binarny QDataStream ----------
function ymdToJd(y, m, d) {
  const a = Math.floor((14 - m) / 12);
  const y2 = y + 4800 - a;
  const m2 = m + 12 * a - 3;
  return d + Math.floor((153 * m2 + 2) / 5) + 365 * y2
    + Math.floor(y2 / 4) - Math.floor(y2 / 100) + Math.floor(y2 / 400) - 32045;
}

function buildWsjtx() {
  const parts = [];
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v); parts.push(b); };
  const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(v)); parts.push(b); };
  const i64 = (v) => { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v)); parts.push(b); };
  const i8 = (v) => { const b = Buffer.alloc(1); b.writeInt8(v); parts.push(b); };
  const str = (sv) => {
    if (sv === null || sv === undefined) { u32(0xffffffff); return; }
    const b = Buffer.from(String(sv), 'utf8');
    u32(b.length); parts.push(b);
  };
  const dt = () => {
    i64(ymdToJd(Y, M, D));
    u32(((h * 3600) + (mi * 60) + s) * 1000);
    i8(1); // Qt::UTC
  };

  u32(0xadbccbda); // magic
  u32(2);          // schema
  u32(5);          // type = QSO Logged
  str('WSJT-X');   // client id

  dt();                       // Date & Time Off
  str(call);                  // DX call
  str('JO90');                // DX grid
  u64(Math.round(mhz * 1e6)); // Tx frequency (Hz)
  str(mode);                  // Mode
  str('-10');                 // Report sent
  str('-12');                 // Report received
  str('50');                  // Tx power
  str('test bridge');         // Comments
  str('Tester');              // Name
  dt();                       // Date & Time On
  str(operator);              // Operator call
  str(station);               // My call
  str('KO02');                // My grid
  str('');                    // Exchange sent
  str('');                    // Exchange received

  return Buffer.concat(parts);
}

const BUILDERS = { qlog: buildQLog, n1mm: buildN1MM, wsjtx: buildWsjtx };
const build = BUILDERS[format];
if (!build) {
  console.error(`Nieznany format "${format}". Dostępne: ${Object.keys(BUILDERS).join(', ')}`);
  process.exit(1);
}

const cfg = loadConfig();
const socket = dgram.createSocket('udp4');
const buf = build();

socket.send(buf, cfg.udp.port, cfg.udp.host, (err) => {
  if (err) {
    console.error('Błąd wysyłki:', err.message);
    process.exit(1);
  }
  console.log(`[${format}] ${call} ${band}/${mode} ${mhz} MHz | stacja=${station} operator=${operator} (${buf.length} B) → ${cfg.udp.host}:${cfg.udp.port}`);
  socket.close();
});
