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
