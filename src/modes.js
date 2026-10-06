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

/**
 * Emisja z rekordu ADIF, z uwzględnieniem `SUBMODE`.
 *
 * ADIF trzyma FT4 jako `MODE=MFSK` + `SUBMODE=FT4`, bo FT4 formalnie jest
 * podtypem MFSK. Programy robią to RÓŻNIE i zmierzyliśmy to 2026-10-06 na
 * jednym QSO z MSHV, wysłanym jednocześnie dwoma komunikatami:
 *
 *   typ 5  (binarny) → MODE=FT4
 *   typ 12 (ADIF)    → MODE=MFSK, SUBMODE=FT4
 *
 * Czytając samo `MODE` wysyłaliśmy na serwer „MFSK", czyli gubiliśmy emisję,
 * którą operator realnie pracował. Gorzej: oba komunikaty dawały różny odcisk
 * treści, więc TA SAMA łączność poszłaby DWA RAZY.
 *
 * `SUBMODE` jest bardziej szczegółowy, więc ma pierwszeństwo — to nie jest
 * zgadywanie, tylko wybór dokładniejszej z dwóch podanych wartości. Dla SSB
 * wychodzi na to samo: `MODE=SSB, SUBMODE=USB` → `USB` → alias → `SSB`.
 */
export function modeZRekordu(adif) {
  return normalizeMode(adif?.submode || adif?.mode);
}

/**
 * Rodzina, z której pochodzi podtyp — albo `null`, gdy podtypu nie było.
 *
 * Potrzebna, bo emisji NIE OCENIAMY sami. Wysyłamy to, co podał logger (podtyp
 * jest dokładniejszy, więc wygrywa), a gdy serwer odpowie `INVALID_MODE`,
 * worker ponawia to samo QSO z rodziną. Decyzję o tym, co jest obsługiwane,
 * podejmuje więc serwer, a nie nasza lista wpisana w kod.
 *
 * Powód, dla którego to się liczy: `INVALID_MODE` jest odrzuceniem TRWAŁYM —
 * QSO ląduje w `failed/` i nie trafia do dyplomu wcale. Zmierzone 2026-10-06:
 * serwer przyjmuje FT4, C4FM, PSK31, DIGI, NXDN i FT2, a odrzuca JS8 i Q65.
 * Łączność JS8 przychodzi jako MODE=MFSK + SUBMODE=JS8, więc bez ponowienia
 * przepadłaby — mimo że jako MFSK zostałaby przyjęta.
 */
export function rodzinaEmisji(adif) {
  const podtyp = normalizeMode(adif?.submode);
  const rodzina = normalizeMode(adif?.mode);
  return podtyp && rodzina && podtyp !== rodzina ? rodzina : null;
}
