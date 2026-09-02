// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Atomowy zapis pliku, odporny na zachowanie Windows.
//
// Wzorzec „zapisz do .tmp i zmień nazwę" jest atomowy na Linuksie, gdzie rename
// zawsze nadpisuje cel. Na Windows to samo potrafi się wywalić (EPERM/EACCES/
// EEXIST), gdy plik docelowy jest chwilowo otwarty — typowo przez antywirusa,
// indeksator albo kopię zapasową. Efekt jest zdradliwy: konfiguracja w pamięci
// ma już nową wartość, a na dysku zostaje stara.
//
// Dlatego: kilka ponowień z krótką przerwą, a w ostateczności usunięcie celu
// przed zmianą nazwy.
import { writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';

const RETRYABLE = new Set(['EPERM', 'EACCES', 'EEXIST', 'EBUSY']);

/** Krótkie oczekiwanie bez async — zapis musi pozostać synchroniczny. */
function pause(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) { /* celowo puste */ }
}

/**
 * @param {string} path  plik docelowy
 * @param {string} text  zawartość
 * @throws gdy zapis się nie powiódł — cisza byłaby tu najgorsza
 */
export function writeAtomic(path, text) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);

  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      renameSync(tmp, path);
      return path;
    } catch (err) {
      lastErr = err;
      if (!RETRYABLE.has(err.code)) break;
      pause(attempt * 40);

      // Ostatnia próba: usuń cel i zmień nazwę. Okno, w którym pliku nie ma,
      // jest milisekundowe, a alternatywą byłby brak zapisu w ogóle.
      if (attempt === 4) {
        try { if (existsSync(path)) unlinkSync(path); } catch { /* i tak spróbujemy */ }
      }
    }
  }

  try { unlinkSync(tmp); } catch { /* sprzątanie best-effort */ }
  throw new Error(`Nie mogę zapisać ${path}: ${lastErr?.code || ''} ${lastErr?.message || lastErr}`);
}
