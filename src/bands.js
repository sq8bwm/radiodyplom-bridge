// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Wyliczanie pasma ADIF z częstotliwości. N1MM i WSJT-X nie podają pasma wprost.
// Zakresy wg ADIF Specification (Band Enumeration).
const BANDS = [
  ['2190m', 0.1357, 0.1378],
  ['630m', 0.472, 0.479],
  ['560m', 0.501, 0.504],
  ['160m', 1.8, 2.0],
  ['80m', 3.5, 4.0],
  ['60m', 5.06, 5.45],
  ['40m', 7.0, 7.3],
  ['30m', 10.1, 10.15],
  ['20m', 14.0, 14.35],
  ['17m', 18.068, 18.168],
  ['15m', 21.0, 21.45],
  ['12m', 24.89, 24.99],
  ['10m', 28.0, 29.7],
  ['8m', 40.0, 45.0],
  ['6m', 50.0, 54.0],
  ['5m', 54.000001, 69.9],
  ['4m', 70.0, 71.0],
  ['2m', 144.0, 148.0],
  ['1.25m', 222.0, 225.0],
  ['70cm', 420.0, 450.0],
  ['33cm', 902.0, 928.0],
  ['23cm', 1240.0, 1300.0],
  ['13cm', 2300.0, 2450.0],
  ['9cm', 3300.0, 3500.0],
  ['6cm', 5650.0, 5925.0],
  ['3cm', 10000.0, 10500.0],
  ['1.25cm', 24000.0, 24250.0],
];

/**
 * @param {number} mhz częstotliwość w MHz
 * @returns {string|null} pasmo ADIF (np. "40m") albo null, jeśli poza pasmami
 */
export function bandFromMHz(mhz) {
  if (!Number.isFinite(mhz) || mhz <= 0) return null;
  for (const [name, lo, hi] of BANDS) {
    if (mhz >= lo && mhz <= hi) return name;
  }
  return null;
}

export function bandFromHz(hz) {
  return bandFromMHz(Number(hz) / 1e6);
}

/** Czy taki napis jest nazwą pasma ADIF (np. „20m"). */
export function czyNazwaPasma(nazwa) {
  if (!nazwa) return false;
  const n = String(nazwa).trim().toLowerCase();
  return BANDS.some(([name]) => name === n);
}

/**
 * Czy częstotliwość mieści się w TYM paśmie.
 *
 * Potrzebne, gdy logger podaje i pasmo, i częstotliwość w nieznanej jednostce:
 * pasmo rozstrzyga, który przelicznik był właściwy. Patrz `src/decoders/n1mm.js`.
 */
export function pasmoZawiera(nazwa, mhz) {
  if (!Number.isFinite(mhz)) return false;
  const n = String(nazwa ?? '').trim().toLowerCase();
  const wiersz = BANDS.find(([name]) => name === n);
  return !!wiersz && mhz >= wiersz[1] && mhz <= wiersz[2];
}

/**
 * Pasmo zapisane tak, jak chce ADIF: małymi literami („20m").
 *
 * Loggery piszą różnie — MSHV w rekordzie ADIF daje „20M", nasze własne
 * wyliczenie z częstotliwości daje „20m". Bez ujednolicenia ta sama łączność
 * z dwóch komunikatów tego samego programu miała różny odcisk treści i szła
 * na serwer dwa razy (zmierzone 2026-10-06).
 */
export function normalizujPasmo(pasmo) {
  const p = String(pasmo ?? '').trim().toLowerCase();
  return czyNazwaPasma(p) ? p : String(pasmo ?? '').trim();
}
