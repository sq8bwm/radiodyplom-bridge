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
import { bezBom } from './config.js';

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
/** Domyślny port nasłuchu TCP — ten sam, co w szablonie konfiguracji i w Logger32. */
export const DOMYSLNY_PORT_TCP = 52005;

const wolnyTcp = (port, host = '127.0.0.1') => new Promise((gotowe) => {
  const s = createServer();
  s.once('error', () => gotowe(false));
  s.listen({ host, port }, () => s.close(() => gotowe(true)));
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
// `doKtorego` liczone OD `od`, a nie wpisane na stałe: przy porcie spoza
// okolic 12060 (ktoś ustawił wyżej, albo tak wyszło przy zasiewie) sztywny
// sufit sprawiał, że pętla nie wykonywała ani jednego obrotu i funkcja
// zwracała null — czyli zajęty port NIE był przestawiany, bez słowa w logu.
// Złapane testem 2026-10-04 po odejściu od stałych portów w testach.
export async function wolnaParaPortow({ od = 12070, doKtorego = od + 130 } = {}) {
  for (let p = od; p <= doKtorego; p += 10) {
    // eslint-disable-next-line no-await-in-loop -- próby MUSZĄ być po kolei
    if (await wolnyUdp(p) && await wolnyTcp(p + 1)) {
      return { udp: p, api: p + 1, tcp: await wolnyPortLogger32() };
    }
  }
  return null;
}

/**
 * Wolny port nasłuchu TCP dla Logger32.
 *
 * Osobna pula i osobny skok, bo to zupełnie inny numer niż porty UDP
 * i interfejsu — Logger32 ma domyślnie 52005 i tyle samo ma szablon
 * konfiguracji. Druga instancja dostaje 52015, trzecia 52025 i tak dalej,
 * żeby numer dało się zapamiętać i przepisać do Logger32.
 *
 * Dlaczego w ogóle: bind TCP jest wyłączny, więc dwie instancje z włączonym
 * Logger32 na tym samym porcie znaczą, że DRUGA NIE WSTANIE WCALE — wyjątek
 * ze startu nasłuchu przerywa start całego rdzenia, razem z UDP.
 *
 * @returns {Promise<number|null>} null = w całej puli nie ma wolnego
 */
export async function wolnyPortLogger32({
  od = DOMYSLNY_PORT_TCP + 10, doKtorego = od + 190, host = '127.0.0.1',
} = {}) {
  for (let p = od; p <= doKtorego; p += 10) {
    // eslint-disable-next-line no-await-in-loop -- próby MUSZĄ być po kolei
    if (await wolnyTcp(p, host)) return p;
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
    // Port TCP wpisujemy nawet przy wyłączonym nasłuchu Logger32. Włączenie go
    // jest jednym kliknięciem, a wtedy domyślne 52005 byłoby już zajęte przez
    // tamtą instancję — i ta NIE WSTAŁABY wcale, bo błąd nasłuchu przerywa
    // start całego rdzenia.
    if (porty.tcp) cfg.tcp = { ...(cfg.tcp || {}), port: porty.tcp };
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
    cfg = JSON.parse(bezBom(readFileSync(plikCfg)));
  } catch {
    return null; // nieczytelna konfiguracja to nie nasza sprawa na tym etapie
  }

  const host = cfg.udp?.host || '127.0.0.1';
  const udp = Number(cfg.udp?.port) || 12060;
  const api = Number(cfg.api?.port) || udp + 1;
  // Wyłączonego nasłuchu UDP nie ma sensu mierzyć: portu i tak nie otworzymy,
  // a zajęte 12060 przestawiałoby parę portów bez żadnego powodu.
  const udpWlaczony = cfg.udp?.enabled !== false;
  const paraWolna = (!udpWlaczony || await wolnyUdp(udp, host)) && await wolnyTcp(api);

  let porty = null;
  if (!paraWolna) {
    porty = await wolnaParaPortow({ od: udp + 10 });
    if (porty) {
      cfg.udp.port = porty.udp;
      cfg.api.port = porty.api;
    }
  }

  // Nasłuch Logger32 ma własny port i własną pulę. Sprawdzamy go TYLKO, gdy
  // jest włączony — wyłączony niczego nie zajmie, a szablon ma go wyłączonego.
  let tcp = null;
  if (cfg.tcp?.enabled) {
    const portTcp = Number(cfg.tcp.port) || DOMYSLNY_PORT_TCP;
    const hostTcp = cfg.tcp.host || '127.0.0.1';
    if (!await wolnyTcp(portTcp, hostTcp)) {
      tcp = await wolnyPortLogger32({ od: portTcp + 10, host: hostTcp });
      if (tcp) cfg.tcp.port = tcp;
    }
  }

  if (!porty && !tcp) return null;
  writeFileSync(plikCfg, `${JSON.stringify(cfg, null, 2)}\n`);
  return {
    udp: cfg.udp.port,
    api: cfg.api.port,
    tcp: cfg.tcp?.enabled ? cfg.tcp.port : null,
    // Co faktycznie przestawiliśmy — okno ma powiedzieć o tym, co się zmieniło,
    // a nie wyliczyć wszystkie porty, z których większość została ta sama.
    zmienione: [...(porty ? ['udp', 'api'] : []), ...(tcp ? ['tcp'] : [])],
  };
}
