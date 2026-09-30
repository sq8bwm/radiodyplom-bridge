// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Parser pojedynczego rekordu ADIF (taki, jaki QLog wkłada w pole data.value).
// Format tagu: <name:length[:type]>value ... <eor>

/**
 * Parsuje łańcuch ADIF do obiektu { pole: wartość } (klucze małymi literami).
 * Długość wartości bierzemy z deklaracji tagu, więc znaki < > w wartości są bezpieczne.
 */
export function parseAdif(str) {
  const out = {};
  if (!str || typeof str !== 'string') return out;

  const tagRe = /<([A-Za-z0-9_]+)(?::(\d+))?(?::[A-Za-z])?>/g;
  let m;
  while ((m = tagRe.exec(str)) !== null) {
    const name = m[1].toLowerCase();
    if (name === 'eor' || name === 'eoh') break;

    const len = m[2] !== undefined ? parseInt(m[2], 10) : 0;
    const valStart = tagRe.lastIndex;
    const value = len > 0 ? str.substr(valStart, len) : '';
    out[name] = value;

    // Przeskocz o długość wartości (dla tagów bez długości zostajemy na miejscu).
    tagRe.lastIndex = valStart + len;
  }
  return out;
}

/**
 * Znajduje koniec PIERWSZEGO kompletnego rekordu (albo nagłówka) w tekście.
 *
 * Potrzebne przy nasłuchu TCP: Logger32 wysyła ADIF strumieniem, który może
 * przyjść w kawałkach albo z kilkoma rekordami naraz. Idziemy po tagach
 * z deklarowaną długością, więc „<eor>" WEWNĄTRZ wartości (np. w komentarzu
 * albo w nazwie QTH) nie utnie rekordu w złym miejscu — a to jest cała
 * różnica między tym a naiwnym `split('<eor>')`.
 *
 * @returns {{koniec:number, naglowek:boolean}|null} null = rekord jeszcze niekompletny
 */
export function koniecRekordu(str) {
  const tagRe = /<([A-Za-z0-9_]+)(?::(\d+))?(?::[A-Za-z])?>/g;
  let m;
  while ((m = tagRe.exec(str)) !== null) {
    const name = m[1].toLowerCase();
    if (name === 'eor' || name === 'eoh') {
      return { koniec: tagRe.lastIndex, naglowek: name === 'eoh' };
    }
    const len = m[2] !== undefined ? parseInt(m[2], 10) : 0;
    const valStart = tagRe.lastIndex;
    // Wartość jeszcze nie doszła w całości — czekamy na kolejny kawałek.
    if (valStart + len > str.length) return null;
    tagRe.lastIndex = valStart + len;
  }
  return null;
}
