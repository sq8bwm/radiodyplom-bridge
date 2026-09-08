// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Certyfikat samopodpisany BEZ zewnętrznych narzędzi — samym `node:crypto`.
//
// Po co: mostek wystawiał certyfikat, wołając `openssl`, bo Node umie X.509
// tylko CZYTAĆ, nie tworzyć. Na Linuksie i Raspberry Pi OS openssl jest zawsze,
// ale na Windowsie zwykle nie — i tam nasłuch w sieci był po prostu odrzucany
// (zgłoszone 2026-09-08 z prawdziwego Windowsa). Ten moduł zdejmuje ten wymóg.
//
// Co Node daje gotowe, więc czego NIE kodujemy ręcznie:
//   - klucz publiczny w postaci SubjectPublicKeyInfo (`export({type:'spki'})`),
//   - podpis sha256WithRSA (`sign`).
// Ręcznie kodujemy tylko szkielet ASN.1/DER: SEQUENCE, INTEGER, OID, czas
// i rozszerzenia. To rzemiosło, nie kryptografia.
//
// Jak to sprawdzamy (test/certyfikat.test.js) — trzy niezależne drogi:
//   1. `crypto.X509Certificate` — parser Node, czyli OpenSSL w środku,
//   2. PRAWDZIWY uścisk dłoni TLS, także po adresie IP (tak wchodzi telefon),
//   3. `openssl x509` jako trzecia opinia, gdy narzędzie jest pod ręką.
// Pierwsza wersja tego kodu miała błąd w kodowaniu czasu (zostawiała „T" ze
// środka formatu ISO) i parser Node zgłosił „Bad time value" natychmiast.
import { generateKeyPairSync, sign, randomBytes } from 'node:crypto';

// ---------- minimalny koder DER ----------

/** Długość w postaci DER: krótka do 127, dłuższa z licznikiem bajtów. */
function dlugosc(n) {
  if (n < 0x80) return Buffer.from([n]);
  const b = [];
  for (let x = n; x > 0; x >>= 8) b.unshift(x & 0xff);
  return Buffer.from([0x80 | b.length, ...b]);
}

function tlv(tag, ...dane) {
  const tresc = Buffer.concat(dane.map((d) => (Buffer.isBuffer(d) ? d : Buffer.from(d))));
  return Buffer.concat([Buffer.from([tag]), dlugosc(tresc.length), tresc]);
}

const SEQ = (...d) => tlv(0x30, ...d);
const SET = (...d) => tlv(0x31, ...d);
const OCT = (buf) => tlv(0x04, buf);
const UTF8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const BOOL = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
const NULL = Buffer.from([0x05, 0x00]);
const jawny = (nr, ...d) => tlv(0xa0 | nr, ...d);

/** INTEGER. Wiodące zero przy ustawionym najwyższym bicie — inaczej liczba byłaby ujemna. */
const INT = (buf) => tlv(0x02, buf[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buf]) : buf);

/** BIT STRING z zerową liczbą nieużywanych bitów. */
const BIT = (buf) => tlv(0x03, Buffer.concat([Buffer.from([0]), buf]));

/** OID w zapisie base-128: dwa pierwsze łuki w jednym bajcie. */
function OID(txt) {
  const cz = txt.split('.').map(Number);
  const out = [cz[0] * 40 + cz[1]];
  for (const v of cz.slice(2)) {
    const g = [];
    let x = v;
    do { g.unshift(x & 0x7f); x >>= 7; } while (x > 0);
    for (let i = 0; i < g.length - 1; i += 1) g[i] |= 0x80;
    out.push(...g);
  }
  return tlv(0x06, Buffer.from(out));
}

/**
 * UTCTime to DOKŁADNIE „RRMMDDGGMMSSZ".
 *
 * Bez „T" ze środka formatu ISO i bez milisekund — pierwsza wersja zostawiała
 * „T" i parser od razu odrzucał certyfikat („Bad time value").
 */
const czasUTC = (d) => tlv(0x17, Buffer.from(
  d.toISOString().replace(/[-:T]/g, '').replace(/\.\d{3}/, '').slice(2), 'ascii'));

const ALG_SHA256_RSA = SEQ(OID('1.2.840.113549.1.1.11'), NULL);
const nazwaCN = (cn) => SEQ(SET(SEQ(OID('2.5.4.3'), UTF8(cn))));

/**
 * subjectAltName: nazwy DNS ([2] IA5String) i adresy IPv4 ([7] OCTET STRING).
 *
 * SAN, a nie CN, bo przeglądarki od lat sprawdzają wyłącznie SAN. Adresy są tu
 * ważniejsze od nazw: z telefonu wchodzi się po adresie IP.
 */
function san(nazwy, adresy) {
  const dns = nazwy.map((n) => tlv(0x82, Buffer.from(String(n), 'ascii')));
  const ip = adresy
    .map((a) => String(a).split('.').map(Number))
    .filter((cz) => cz.length === 4 && cz.every((x) => Number.isInteger(x) && x >= 0 && x <= 255))
    .map((cz) => tlv(0x87, Buffer.from(cz)));
  return SEQ(OID('2.5.29.17'), OCT(SEQ(...dns, ...ip)));
}

/** Ile dni ma być ważny. Dwa lata: dość rzadko, by nie męczyć, dość krótko, by nie zalegać. */
export const DNI_WAZNOSCI = 730;

/**
 * Wystawia certyfikat samopodpisany i klucz, oba w PEM.
 *
 * @param {object} opts
 * @param {string} opts.cn        nazwa w podmiocie (zwykle nazwa maszyny)
 * @param {string[]} [opts.nazwy] nazwy DNS do SAN
 * @param {string[]} [opts.adresy] adresy IPv4 do SAN
 * @param {number} [opts.dni]     ważność w dniach
 * @returns {{cert:string, key:string}}
 */
export function wystawCertyfikat({ cn, nazwy = [], adresy = [], dni = DNI_WAZNOSCI }) {
  if (!cn || !String(cn).trim()) throw new Error('Certyfikat wymaga nazwy (cn)');

  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' });

  const teraz = Date.now();
  // Minuta wstecz: zegary maszyn się rozjeżdżają, a certyfikat „z przyszłości"
  // jest odrzucany bez czytelnego powodu.
  const od = new Date(teraz - 60_000);
  const doKiedy = new Date(teraz + dni * 86_400_000);

  const rozszerzenia = jawny(3, SEQ(
    SEQ(OID('2.5.29.19'), BOOL(true), OCT(SEQ())),                     // basicConstraints: CA:FALSE
    SEQ(OID('2.5.29.15'), BOOL(true), OCT(BIT(Buffer.from([0xa0])))),  // keyUsage: podpis + szyfrowanie klucza
    SEQ(OID('2.5.29.37'), OCT(SEQ(OID('1.3.6.1.5.5.7.3.1')))),         // EKU: serverAuth
    san(nazwy, adresy),
  ));

  const tbs = SEQ(
    jawny(0, INT(Buffer.from([2]))),        // wersja v3
    // Numer seryjny LOSOWY. Stały powodowałby, że dwa certyfikaty tej samej
    // maszyny są nierozróżnialne dla magazynu zaufania przeglądarki.
    INT(randomBytes(16)),
    ALG_SHA256_RSA,
    nazwaCN(cn),
    SEQ(czasUTC(od), czasUTC(doKiedy)),
    nazwaCN(cn),                            // samopodpisany: wystawca = podmiot
    spki,
    rozszerzenia,
  );

  const cert = SEQ(tbs, ALG_SHA256_RSA, BIT(sign('sha256', tbs, privateKey)));

  const pem = (typ, buf) => `-----BEGIN ${typ}-----\n`
    + `${buf.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '')}\n`
    + `-----END ${typ}-----\n`;

  return {
    cert: pem('CERTIFICATE', cert),
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}
