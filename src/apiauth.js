// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Uwierzytelnianie i TLS dla API stanu — wszystko, co jest potrzebne, żeby
// interfejs mógł nasłuchiwać poza `127.0.0.1`.
//
// Zasada nadrzędna: FAIL-CLOSED. Każdy brak (hasła, HTTPS-a, certyfikatu)
// kończy się pozostaniem na localhoście i wpisem w logu — nigdy otwartym
// portem bez ochrony. Otwarty port bez hasła jest gorszy niż brak funkcji:
// przez `POST /api/config` można podmienić PIN i przekierować cudze QSO.
//
// Zero zależności: `node:crypto` ma scrypt i porównanie stałoczasowe, a jedynego,
// czego nie umie — WYSTAWIĆ certyfikat X.509 (umie tylko czytać) — dokłada nasz
// `cert.js`. Gdy w systemie jest `openssl`, wołamy jego; gdy nie ma (typowy
// Windows), kodujemy certyfikat sami. Patrz `przygotujCertyfikat`.
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { hostname, networkInterfaces } from 'node:os';
import { writeFileSync } from 'node:fs';
import { log } from './log.js';
import { wystawCertyfikat } from './cert.js';

/** Adresy, na których nasłuch NIE jest wystawieniem do sieci. */
const LOKALNE = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * Parametry scrypt. N=2^15 to około 100 ms na malince — dość przy jednym
 * logowaniu, a kosztowne przy zgadywaniu.
 *
 * `maxmem` MUSI być podany: te parametry potrzebują 128·N·r = 32 MB, a Node ma
 * domyślny limit dokładnie 32 MB i odrzuca żądanie jako „memory limit exceeded".
 */
const SCRYPT = { N: 32768, r: 8, p: 1, dkLen: 32, maxmem: 64 * 1024 * 1024 };

/** Ile trwa sesja. Mostek pracuje godzinami, ale sesja nie musi. */
export const SESJA_MS = 12 * 60 * 60 * 1000;

/** Blokada logowania: po tylu nieudanych próbach z jednego adresu. */
const PROG_BLOKADY = 5;
const BLOKADA_MS = 60 * 1000;          // rośnie dwukrotnie do MAX
const BLOKADA_MAX_MS = 15 * 60 * 1000;

/**
 * Powody odmowy nasłuchu w sieci — KODY, nie tekst.
 *
 * Kod jedzie do okna (które tłumaczy go na język użytkownika i dokłada radę,
 * co zrobić), a tekst stąd trafia do logu. Wcześniej `powody` były polskim
 * tekstem: w logu w porządku, ale okno nie miało z czego zbudować komunikatu,
 * więc powód odmowy nie docierał do nikogo, kto do logu nie zagląda.
 */
export const POWODY = {
  'brak-hasla': 'nie ustawiono hasła (api.auth.password)',
  'tls-wylaczony': 'TLS wyłączony w konfiguracji',
  'brak-certyfikatu': 'nie udało się przygotować certyfikatu TLS',
};

export function czyLokalny(host) {
  return LOKALNE.has(String(host || '127.0.0.1'));
}

// ---------- hasło ----------

/**
 * Hasz hasła w postaci `scrypt$<sól-hex>$<klucz-hex>`.
 *
 * Format z nazwą algorytmu z przodu, żeby dało się kiedyś zmienić parametry
 * bez zgadywania, czym stary hasz był policzony.
 */
export function zahaszujHaslo(haslo) {
  const czyste = String(haslo ?? '');
  if (czyste.length < 8) throw new Error('Hasło musi mieć co najmniej 8 znaków');
  const sol = randomBytes(16);
  const klucz = scryptSync(czyste, sol, SCRYPT.dkLen, SCRYPT);
  return `scrypt$${sol.toString('hex')}$${klucz.toString('hex')}`;
}

/**
 * Sprawdza hasło wobec hasza. Porównanie STAŁOCZASOWE — inaczej czas
 * odpowiedzi zdradza, ile pierwszych bajtów się zgadza.
 */
export function sprawdzHaslo(haslo, hasz) {
  if (!hasz || typeof hasz !== 'string') return false;
  const [algo, solHex, kluczHex] = hasz.split('$');
  if (algo !== 'scrypt' || !solHex || !kluczHex) return false;
  try {
    const oczekiwany = Buffer.from(kluczHex, 'hex');
    const policzony = scryptSync(String(haslo ?? ''), Buffer.from(solHex, 'hex'),
      oczekiwany.length, SCRYPT);
    return timingSafeEqual(policzony, oczekiwany);
  } catch {
    return false;
  }
}

/** Czy w konfiguracji jest ustawione hasło. */
export function hasloUstawione(cfg) {
  const h = cfg?.api?.auth?.passwordHash;
  return typeof h === 'string' && h.startsWith('scrypt$');
}

// ---------- sesje i CSRF ----------

export class Sesje {
  constructor({ teraz = () => Date.now() } = {}) {
    this.mapa = new Map();
    this.teraz = teraz;
  }

  utworz() {
    const id = randomBytes(32).toString('hex');
    const csrf = randomBytes(32).toString('hex');
    this.mapa.set(id, { csrf, wygasa: this.teraz() + SESJA_MS });
    return { id, csrf };
  }

  /** Zwraca sesję albo null. Po drodze usuwa wygasłe. */
  pobierz(id) {
    if (!id) return null;
    const s = this.mapa.get(id);
    if (!s) return null;
    if (s.wygasa <= this.teraz()) { this.mapa.delete(id); return null; }
    return s;
  }

  usun(id) { this.mapa.delete(id); }
  ile() { return this.mapa.size; }
}

/**
 * Blokada po nieudanych próbach logowania.
 *
 * Mostek stoi godzinami, więc zgadywanie hasła ma czas — bez tego długie
 * hasło jest jedyną obroną, a ludzie wpisują krótkie.
 */
export class Blokada {
  constructor({ teraz = () => Date.now() } = {}) {
    this.mapa = new Map();
    this.teraz = teraz;
  }

  /** Ile ms trzeba jeszcze czekać (0 = można próbować). */
  ileCzekac(adres) {
    const w = this.mapa.get(adres);
    if (!w || !w.do) return 0;
    return Math.max(0, w.do - this.teraz());
  }

  nieudana(adres) {
    const w = this.mapa.get(adres) || { proby: 0, kara: BLOKADA_MS, do: 0 };
    w.proby += 1;
    if (w.proby >= PROG_BLOKADY) {
      w.do = this.teraz() + w.kara;
      w.kara = Math.min(w.kara * 2, BLOKADA_MAX_MS);
      w.proby = 0;
    }
    this.mapa.set(adres, w);
    return w.do ? Math.max(0, w.do - this.teraz()) : 0;
  }

  udana(adres) { this.mapa.delete(adres); }
}

// ---------- ciasteczko sesji ----------

export const CIASTKO = 'rdb_sesja';

export function odczytajCiastko(naglowek, nazwa = CIASTKO) {
  if (!naglowek) return null;
  for (const czesc of String(naglowek).split(';')) {
    const i = czesc.indexOf('=');
    if (i < 0) continue;
    if (czesc.slice(0, i).trim() === nazwa) return czesc.slice(i + 1).trim();
  }
  return null;
}

/**
 * Ciasteczko sesji.
 *
 * `HttpOnly` — skrypt na stronie nie ma po co go czytać, a to zamyka kradzież
 * sesji przez wstrzyknięty skrypt. `SameSite=Strict` — obca strona nie dołączy
 * go do żądania, co samo w sobie zdejmuje większość CSRF; token w nagłówku jest
 * drugą warstwą, bo `SameSite` bywa różnie wspierane. `Secure` tylko przy TLS,
 * inaczej przeglądarka odrzuciłaby ciasteczko po zwykłym HTTP na localhoście.
 */
export function ciastkoSesji(id, { tls }) {
  const czesci = [`${CIASTKO}=${id}`, 'Path=/', 'HttpOnly', 'SameSite=Strict',
    `Max-Age=${Math.floor(SESJA_MS / 1000)}`];
  if (tls) czesci.push('Secure');
  return czesci.join('; ');
}

export function ciastkoWygaszone({ tls }) {
  const czesci = [`${CIASTKO}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (tls) czesci.push('Secure');
  return czesci.join('; ');
}

// ---------- certyfikat ----------

/** Czy w systemie jest openssl (Node nie umie wystawiać certyfikatów). */
export function czyOpenssl() {
  try {
    execFileSync('openssl', ['version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Adresy IPv4 tej maszyny — do SAN certyfikatu i do pokazania w oknie. */
export function adresyLokalne() {
  const out = [];
  for (const lista of Object.values(networkInterfaces() || {})) {
    for (const a of lista || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

/**
 * Zwraca ścieżki certyfikatu i klucza, wystawiając własny, jeśli trzeba.
 *
 * Certyfikat własny (nie od urzędu) chroni treść na kablu, ale NIE chroni przed
 * podszyciem się pod serwer w tej samej sieci — przeglądarka nie ma czym go
 * sprawdzić. To świadomy kompromis, opisany w dokumentacji, a nie przemilczany.
 *
 * @returns {{cert:string, key:string, wystawiony:boolean}|null}
 */
export function przygotujCertyfikat({ cfg, dataDir, wymusWlasny = false }) {
  const tls = cfg?.api?.tls || {};
  if (tls.certFile && tls.keyFile) {
    if (!existsSync(tls.certFile) || !existsSync(tls.keyFile)) {
      log.error(`TLS: podane pliki certyfikatu nie istnieją (${tls.certFile}, ${tls.keyFile})`);
      return null;
    }
    return { cert: tls.certFile, key: tls.keyFile, wystawiony: false };
  }

  const katalog = join(dataDir, 'tls');
  const cert = join(katalog, 'cert.pem');
  const key = join(katalog, 'key.pem');
  if (existsSync(cert) && existsSync(key)) return { cert, key, wystawiony: false };

  const nazwa = hostname() || 'radiodyplom-bridge';
  const nazwy = ['localhost', nazwa];
  const adresy = ['127.0.0.1', ...adresyLokalne()];

  // Dwie drogi, świadomie w tej kolejności:
  //  - `openssl`, gdy jest — sprawdzony w boju i to on wystawiał certyfikaty
  //    do 0.1.20, więc na Linuksie i malince nic się nie zmienia;
  //  - własny koder DER, gdy openssl-a NIE MA (typowy Windows) — dzięki temu
  //    nasłuch w sieci nie jest już tam odrzucany.
  // `wymusWlasny` pozwala wymusić drugą drogę: testy robią to ZAWSZE, żeby kod
  // używany głównie na Windowsie był sprawdzany codziennie na Linuksie.
  const wlasnymNaStarcie = wymusWlasny || !czyOpenssl();

  const przezOpenssl = () => {
    const san = [...nazwy.map((n) => `DNS:${n}`), ...adresy.map((a) => `IP:${a}`)].join(',');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-sha256',
      '-days', '730', '-nodes', '-keyout', key, '-out', cert,
      '-subj', `/CN=${nazwa}`, '-addext', `subjectAltName=${san}`], { stdio: 'pipe' });
  };

  const przezWlasnyKoder = () => {
    const { cert: pemCert, key: pemKey } = wystawCertyfikat({ cn: nazwa, nazwy, adresy });
    writeFileSync(key, pemKey, { mode: 0o600 });
    writeFileSync(cert, pemCert, { mode: 0o644 });
  };

  try {
    mkdirSync(katalog, { recursive: true, mode: 0o700 });

    let wlasnym = wlasnymNaStarcie;
    if (wlasnym) {
      przezWlasnyKoder();
    } else {
      try {
        przezOpenssl();
      } catch (err) {
        // `openssl` JEST, ale zawiódł: wersja starsza niż 1.1.1 nie zna
        // `-addext`, bywa też brak `openssl.cnf`. Skoro mamy własny koder,
        // odmowa nasłuchu byłaby tu bezsensownym karaniem użytkownika.
        log.warn(`TLS: openssl zawiódł (${err.message.trim().split('\n')[0]}) `
          + '— wystawiam certyfikat wbudowanym koderem');
        przezWlasnyKoder();
        wlasnym = true;
      }
    }

    chmodSync(key, 0o600);
    chmodSync(cert, 0o644);
    log.info(`TLS: wystawiony certyfikat własny na ${nazwa} `
      + `(${[...nazwy, ...adresy].join(', ')})`
      + `${wlasnym ? ' — bez openssl-a, wbudowanym koderem' : ''}`);
    return { cert, key, wystawiony: true, wlasnym };
  } catch (err) {
    log.error(`TLS: nie udało się przygotować certyfikatu: ${err.message}`);
    return null;
  }
}

/** Odcisk certyfikatu do pokazania użytkownikowi — do porównania w przeglądarce. */
export function odciskCertyfikatu(sciezkaCert) {
  try {
    const pem = readFileSync(sciezkaCert, 'utf8');
    const der = Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ''), 'base64');
    const hex = createHash('sha256').update(der).digest('hex').toUpperCase();
    return hex.match(/../g).join(':');
  } catch {
    return null;
  }
}

// ---------- decyzja: gdzie i jak nasłuchiwać ----------

/**
 * Rozstrzyga tryb pracy API na podstawie konfiguracji.
 *
 * Wystawienie do sieci wymaga JEDNOCZEŚNIE hasła i TLS-a. Nie ma tu wyjątku
 * „tylko w mojej sieci": hasło po zwykłym HTTP leci jawnym tekstem, a TLS bez
 * hasła szyfruje połączenie z kimkolwiek. Każdy brak = zostajemy na localhoście.
 *
 * @returns {{host:string, siec:boolean, tls:object|null, readOnly:boolean, powody:string[]}}
 */
export function trybApi({ cfg, dataDir, wymusWlasny = false }) {
  const zadany = String(cfg?.api?.host || '127.0.0.1');
  const chceSieci = !czyLokalny(zadany);
  const powody = [];

  if (!chceSieci) {
    return {
      host: zadany, siec: false, tls: null,
      readOnly: cfg?.api?.readOnly === true,
      powody,
    };
  }

  if (!hasloUstawione(cfg)) powody.push('brak-hasla');

  const tls = cfg?.api?.tls?.enabled === false
    ? null
    : przygotujCertyfikat({ cfg, dataDir, wymusWlasny });
  if (cfg?.api?.tls?.enabled === false) {
    powody.push('tls-wylaczony');
  } else if (!tls) {
    // Rozdzielone, bo rada jest inna: bez openssl-a trzeba podać własny
    // certyfikat albo doinstalować narzędzie (typowy Windows), a przy jego
    // obecności problem jest w plikach albo prawach.
    // Od 0.1.21 brak openssl-a NIE jest już powodem odmowy — mostek wystawia
    // certyfikat sam. Zostaje jeden powód: przygotowanie się nie udało
    // (nieczytelne pliki `certFile`/`keyFile`, brak praw do katalogu danych).
    powody.push('brak-certyfikatu');
  }

  if (powody.length) {
    const opis = powody.map((k) => POWODY[k] || k).join('; ');
    log.error(`API: nasłuch na ${zadany} ODRZUCONY — ${opis}. Zostaję na 127.0.0.1.`);
    return { host: '127.0.0.1', siec: false, tls: null, readOnly: false, powody };
  }

  // W sieci tryb tylko do odczytu jest DOMYŚLNY. Wyłączenie go wymaga jawnego
  // `readOnly: false` — wtedy przez sieć da się zmienić konfigurację i PIN.
  const readOnly = cfg.api.readOnly !== false;
  log.warn(`API nasłuchuje w SIECI na ${zadany}:${cfg.api.port} po HTTPS`
    + `${readOnly ? ', tylko do odczytu' : ', Z PRAWEM ZAPISU'}`);
  return { host: zadany, siec: true, tls, readOnly, powody };
}
