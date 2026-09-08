// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Skąd ten program został uruchomiony — instalator, portable, AppImage, .deb,
// paczka bez interfejsu czy źródła.
//
// Po co: na Windowsie da się mieć obie wersje naraz i DZIELĄ one ten sam
// `%APPDATA%\radiodyplom-bridge` — ten sam config, ten sam PIN, tę samą blokadę
// jednej instancji. Po restarcie nie było więc jak stwierdzić, który plik
// wystartował (zgłoszone 2026-09-08 przy sprawdzaniu przycisku „Zrestartuj
// teraz" w wersji portable). Nie zmienia to zachowania programu, ale zmienia
// możliwość jego sprawdzenia — i to samo trafia do zgłoszenia błędu, gdzie
// „portable" bywa całym wyjaśnieniem dziwnego zachowania.
/**
 * Nazwa pliku ze ścieżki — dzieląc po OBU separatorach.
 *
 * `path.basename` używa separatora bieżącego systemu, więc na Linuksie
 * przepuściłby całe „D:\radio\portable.exe" jako nazwę. Testy tego kodu
 * chodzą właśnie na Linuksie, więc wyszłoby to natychmiast — i wyszło.
 */
const nazwaPliku = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || null;

/**
 * Rozpoznaje rodzaj instalacji.
 *
 * Wszystkie wejścia są parametrami, bo inaczej dałoby się to sprawdzić tylko
 * na tej wersji, która akurat jest uruchomiona — czyli praktycznie nigdy na
 * Windowsie. Nazwy pól odpowiadają temu, co daje `process`.
 *
 * @returns {{rodzaj:string, plik:string|null}}
 */
export function rodzajInstalacji({
  env = process.env,
  execPath = process.execPath,
  platform = process.platform,
  // `process.versions.electron` jest tylko w wersji z okienkiem.
  electron = process.versions.electron,
  // Electron ustawia `defaultApp`, gdy uruchomiono go na katalogu ze źródłami.
  defaultApp = process.defaultApp,
  // Katalog, z którego działa kod — rozstrzyga paczkę bez interfejsu.
  katalog = new URL('.', import.meta.url).pathname,
} = {}) {
  // Kolejność ma znaczenie: portable i AppImage też są „spakowane", więc
  // muszą być rozpoznane PRZED zwykłym instalatorem.
  if (env.PORTABLE_EXECUTABLE_FILE) {
    return { rodzaj: 'portable', plik: nazwaPliku(env.PORTABLE_EXECUTABLE_FILE) };
  }
  if (env.APPIMAGE) return { rodzaj: 'appimage', plik: nazwaPliku(env.APPIMAGE) };

  if (electron) {
    if (defaultApp) return { rodzaj: 'zrodla', plik: null };
    if (platform === 'win32') return { rodzaj: 'instalator', plik: null };
    // Paczka .deb kładzie program w /opt; cokolwiek innego to nie nasza paczka.
    if (execPath.startsWith('/opt/')) return { rodzaj: 'deb', plik: null };
    return { rodzaj: 'pakiet', plik: null };
  }

  // Bez Electrona: albo usługa z paczki bez interfejsu, albo czyste źródła.
  if (katalog.startsWith('/usr/lib/radiodyplom-bridge')) {
    return { rodzaj: 'headless', plik: null };
  }
  return { rodzaj: 'zrodla', plik: null };
}
