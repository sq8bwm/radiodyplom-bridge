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
import {
  existsSync, accessSync, constants, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { createServer } from 'node:net';
import { createSocket } from 'node:dgram';

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

// ---------- katalog danych obok pliku ----------

/** Nazwa katalogu, którym włącza się tryb „dane jadą z plikiem". */
export const KATALOG_PRZENOSNY = 'radiodyplom-dane';

/**
 * Katalog danych OBOK uruchomionego pliku — dla portable i AppImage'a.
 *
 * Świadomie NA ŻYCZENIE: dopiero istnienie katalogu `radiodyplom-dane` obok
 * pliku włącza ten tryb. Gdyby portable zawsze pisał tam, gdzie leży,
 * uruchomienie z „Pobranych" rozsypywałoby tam konfigurację, kolejkę
 * i certyfikat, a ludzie, którzy dziś mają dane w %APPDATA%, straciliby do
 * nich dostęp po zwykłej aktualizacji.
 *
 * Po co w ogóle: bez tego portable i wersja instalowana dzielą JEDEN katalog
 * (`%APPDATA%\radiodyplom-bridge`, na Linuksie `~/.config/radiodyplom-bridge`)
 * — ten sam PIN, tę samą kolejkę i tę samą blokadę jednej instancji, więc nie
 * dają się uruchomić obok siebie. Na cudzym komputerze zostawia to jawny PIN
 * w profilu użytkownika.
 *
 * @returns {{katalog:string, blad?:string}|null} `null` = zostaje domyślny
 */
export function katalogDanychObokPliku({ env = process.env } = {}) {
  const obok = env.PORTABLE_EXECUTABLE_DIR
    || (env.APPIMAGE ? dirname(env.APPIMAGE) : null);
  if (!obok) return null;

  const katalog = join(obok, KATALOG_PRZENOSNY);
  if (!existsSync(katalog)) return null;

  // Pendrive bywa zablokowany do zapisu, a AppImage leży czasem na nośniku
  // tylko do odczytu. Wtedy NIE udajemy, że się udało — wracamy do
  // domyślnego katalogu i mówimy o tym w logu.
  try {
    accessSync(katalog, constants.W_OK);
  } catch {
    return { katalog, blad: 'tylko-do-odczytu' };
  }
  return { katalog };
}

// ---------- zakładanie katalogu na życzenie ----------

/** Czy port TCP jest wolny — próbą zajęcia, bo tylko to jest rozstrzygające. */
const wolnyTcp = (port) => new Promise((gotowe) => {
  const s = createServer();
  s.once('error', () => gotowe(false));
  s.listen({ host: '127.0.0.1', port }, () => s.close(() => gotowe(true)));
});

/**
 * To samo dla UDP. Osobno, bo numer portu TCP i UDP to dwie różne rzeczy.
 *
 * BEZ `reuseAddr`. Nasz mostek binduje z `reuseAddr: true` (potrzebne do
 * multicastu), a wtedy sonda też z `reuseAddr` bindowałaby się OBOK i uznała
 * zajęty port za wolny — zmierzone: z `reuseAddr` „WOLNY", bez niego
 * `EADDRINUSE`. Sonda bez tej opcji wykrywa więc również nasze instancje.
 */
const wolnyUdp = (port, host = '127.0.0.1') => new Promise((gotowe) => {
  const s = createSocket('udp4');
  s.once('error', () => gotowe(false));
  s.bind({ address: host, port }, () => s.close(() => gotowe(true)));
});

/**
 * Wolna para portów dla drugiej instancji: UDP dla loggera i o jeden wyżej dla
 * interfejsu — tak samo jak w domyślnej konfiguracji (12060/12061).
 *
 * Skaczemy po dziesiątkach, żeby numery były zapamiętywalne: 12070, 12080…
 * Bez tego świeża konfiguracja dostawała domyślne 12060, czyli port zajęty
 * przez instancję, która już działa — druga natychmiast padała na blokadzie.
 */
export async function wolnaParaPortow({ od = 12070, doKtorego = 12200 } = {}) {
  for (let p = od; p <= doKtorego; p += 10) {
    // eslint-disable-next-line no-await-in-loop -- próby MUSZĄ być po kolei
    if (await wolnyUdp(p) && await wolnyTcp(p + 1)) return { udp: p, api: p + 1 };
  }
  return null;
}

/**
 * Zakłada katalog `radiodyplom-dane` obok wskazanego pliku programu i wpisuje
 * do niego konfigurację z wolnymi portami.
 *
 * Robione WYŁĄCZNIE na wyraźne życzenie użytkownika (pytanie przy próbie
 * uruchomienia drugiej instancji) — dlatego wolno tu zapisywać obok pliku.
 * Istniejącej konfiguracji nie ruszamy: mogła zostać po wcześniejszej pracy.
 *
 * PIN-u NIE kopiujemy z działającej instancji. Sekret sam z siebie nie
 * powinien wędrować do katalogu, który bywa na pendrivie albo na dysku
 * współdzielonym — wpisanie go zostaje decyzją człowieka.
 *
 * @returns {Promise<{katalog:string, porty:{udp:number,api:number}|null, byloJuz:boolean}>}
 */
export async function zalozKatalogDanych({ plik, przykladowy }) {
  const katalog = join(dirname(plik), KATALOG_PRZENOSNY);
  mkdirSync(katalog, { recursive: true });

  const plikCfg = join(katalog, 'config.json');
  if (existsSync(plikCfg)) return { katalog, porty: null, byloJuz: true };

  const porty = await wolnaParaPortow();
  const cfg = JSON.parse(readFileSync(przykladowy, 'utf8'));
  if (porty) {
    cfg.udp.port = porty.udp;
    cfg.api.port = porty.api;
  }
  writeFileSync(plikCfg, `${JSON.stringify(cfg, null, 2)}\n`);
  return { katalog, porty, byloJuz: false };
}

/**
 * Przy PIERWSZYM uruchomieniu poprawia porty w świeżo zasianej konfiguracji,
 * jeśli domyślne są zajęte.
 *
 * Po co: konfiguracja z szablonu ma 12060/12061. Gdy na maszynie działa już
 * inna instancja mostka (druga wersja programu, usługa systemd), nowa
 * natychmiast padała na blokadzie portu UDP — czyli pierwsze uruchomienie po
 * instalacji kończyło się czerwonym banerem, choć wystarczyło wziąć inny port.
 *
 * Robimy to WYŁĄCZNIE przy zasiewie: później porty są decyzją użytkownika
 * i cichym zmienianiem ich zepsulibyśmy działającą konfigurację loggera.
 *
 * @returns {Promise<{udp:number,api:number}|null>} null = domyślne zostały
 */
export async function dostosujPortyPrzyZasiewie(plikCfg) {
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(plikCfg, 'utf8'));
  } catch {
    return null; // nieczytelna konfiguracja to nie nasza sprawa na tym etapie
  }

  const host = cfg.udp?.host || '127.0.0.1';
  const udp = Number(cfg.udp?.port) || 12060;
  const api = Number(cfg.api?.port) || udp + 1;
  if (await wolnyUdp(udp, host) && await wolnyTcp(api)) return null;

  const porty = await wolnaParaPortow({ od: udp + 10 });
  if (!porty) return null;

  cfg.udp.port = porty.udp;
  cfg.api.port = porty.api;
  writeFileSync(plikCfg, `${JSON.stringify(cfg, null, 2)}\n`);
  return porty;
}
