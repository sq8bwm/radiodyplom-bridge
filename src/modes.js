// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Normalizacja emisji do wartości ADIF.
//
// Zasada: mapujemy WYŁĄCZNIE to, co jest jednoznaczne. Nie zgadujemy emisji,
// bo akcje dyplomowe punktują QSO wg pasma i emisji — zła wartość to
// przekłamanie w logu operatora, którego on nie zobaczy.
//
// USB/LSB to jednoznaczne podmody SSB (ADIF: MODE=SSB, SUBMODE=USB/LSB).
//
// Świadomie NIE mapujemy:
//  - PHONE  – to kategoria (Cabrillo "PH"), nie emisja ADIF. Na 2 m i 70 cm fonia
//             bywa i FM (segmenty FM), i SSB (144.000–144.400, 432.000–432.400),
//             więc każde odwzorowanie po samym paśmie myli się w którąś stronę.
//  - DIGITAL/DIGI – ADIF nie ma emisji "DATA"; wymyślanie jej dałoby wartość
//             nieznaną serwerowi.
// Takie wartości przechodzą surowe (wielkimi literami) i są widoczne w logu.
const ALIASES = {
  USB: 'SSB',
  LSB: 'SSB',
};

/**
 * @param {string} mode surowa emisja z loggera
 * @returns {string} emisja znormalizowana (wielkimi literami)
 */
export function normalizeMode(mode) {
  if (!mode) return '';
  const m = String(mode).trim().toUpperCase();
  return ALIASES[m] || m; // SSB, FM, CW, FT8, PSK31 itd. przechodzą bez zmian
}
