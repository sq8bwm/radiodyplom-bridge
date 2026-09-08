// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Certyfikat wystawiany BEZ openssl-a, samym node:crypto.
//
// Ten kod działa głównie na Windowsie (tam openssl-a zwykle nie ma), więc
// gdyby testy szły domyślną ścieżką, sprawdzalibyśmy go nigdy. Dlatego KAŻDY
// test tutaj wymusza własny koder — także na Linuksie, gdzie openssl jest.
//
// Sprawdzamy TRZEMA niezależnymi drogami, bo sami kodujemy format:
//   1. `crypto.X509Certificate` — parser Node, czyli OpenSSL w środku,
//   2. prawdziwy uścisk dłoni TLS, także po adresie IP (tak wchodzi telefon),
//   3. `openssl x509` jako trzecia opinia, gdy narzędzie jest pod ręką.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import https from 'node:https';
import tls from 'node:tls';

import { wystawCertyfikat, DNI_WAZNOSCI } from '../src/cert.js';
import { przygotujCertyfikat, czyOpenssl } from '../src/apiauth.js';
import { setLevel } from '../src/log.js';

setLevel('error');

const DANE = { cn: 'malinka', nazwy: ['localhost', 'malinka'], adresy: ['127.0.0.1', '192.168.8.50'] };

describe('parser Node przyjmuje nasz certyfikat', () => {
  const { cert } = wystawCertyfikat(DANE);
  const x = new X509Certificate(cert);

  test('podmiot i wystawca (samopodpisany)', () => {
    assert.match(x.subject, /CN=malinka/);
    assert.match(x.issuer, /CN=malinka/);
  });

  test('daty są czytelne', () => {
    // REGRES Z PROTOTYPU: pierwsza wersja zostawiała „T" ze środka formatu ISO
    // i parser mówił „Bad time value". Data nieczytelna = certyfikat bezużyteczny.
    assert.notEqual(x.validTo, 'Bad time value');
    assert.notEqual(x.validFrom, 'Bad time value');
    const dni = (x.validToDate - x.validFromDate) / 86_400_000;
    assert.ok(Math.abs(dni - DNI_WAZNOSCI) < 2, `ważność ${dni.toFixed(1)} dni`);
    assert.ok(x.validFromDate <= new Date(), 'ważny już teraz, nie od przyszłości');
  });

  test('SAN zawiera WSZYSTKIE nazwy i adresy', () => {
    for (const n of DANE.nazwy) assert.match(x.subjectAltName, new RegExp(`DNS:${n}`));
    for (const a of DANE.adresy) assert.ok(x.subjectAltName.includes(a), `brak ${a}`);
  });

  test('sprawdzanie nazwy i adresu działa, obce odrzucone', () => {
    assert.ok(x.checkHost('localhost'));
    assert.ok(x.checkIP('192.168.8.50'));
    assert.equal(x.checkHost('ktos-obcy.example'), undefined);
    assert.equal(x.checkIP('10.0.0.1'), undefined);
  });

  test('podpis własny weryfikuje się', () => {
    assert.equal(x.verify(x.publicKey), true);
  });

  test('numer seryjny jest LOSOWY', () => {
    // Stały numer sprawia, że dwa certyfikaty tej samej maszyny są dla
    // magazynu zaufania przeglądarki nierozróżnialne.
    const a = new X509Certificate(wystawCertyfikat(DANE).cert);
    const b = new X509Certificate(wystawCertyfikat(DANE).cert);
    assert.notEqual(a.serialNumber, b.serialNumber);
    assert.ok(a.serialNumber.length >= 30, `numer za krótki: ${a.serialNumber}`);
  });

  test('klucz prywatny pasuje do certyfikatu', () => {
    const { cert: c2, key } = wystawCertyfikat(DANE);
    assert.equal(new X509Certificate(c2).checkPrivateKey(createPrivateKey(key)), true);
  });

  test('bez nazwy nie wystawiamy', () => {
    assert.throws(() => wystawCertyfikat({ cn: '' }), /wymaga nazwy/);
  });
});

describe('prawdziwy uścisk dłoni TLS', () => {
  const { cert, key } = wystawCertyfikat(DANE);
  let srv;

  after(() => { try { srv?.close(); } catch { /* już zamknięty */ } });

  const polacz = (opcje) => new Promise((res) => {
    const s = tls.connect({ host: '127.0.0.1', port: srv.address().port, ...opcje }, () => {
      res({ ok: s.authorized, blad: s.authorizationError?.message || s.authorizationError });
      s.end();
    });
    s.on('error', (e) => res({ ok: false, blad: e.message }));
  });

  test('serwer wstaje na tym certyfikacie', async () => {
    srv = https.createServer({ cert, key }, (q, o) => { o.writeHead(200); o.end('ok'); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    assert.ok(srv.address().port > 0);
  });

  test('klient ufający certyfikatowi łączy się po nazwie', async () => {
    const w = await polacz({ ca: cert, servername: 'localhost' });
    assert.equal(w.ok, true, `nie autoryzowano: ${w.blad}`);
  });

  test('i po ADRESIE IP — tak wchodzi telefon', async () => {
    const w = await polacz({ ca: cert });
    assert.equal(w.ok, true, `nie autoryzowano po IP: ${w.blad}`);
  });

  test('klient BEZ zaufania odrzuca — stąd pytanie w przeglądarce', async () => {
    const w = await polacz({});
    assert.equal(w.ok, false);
    assert.match(String(w.blad), /self.signed|self signed/i);
  });
});

describe('trzecia opinia: openssl', () => {
  test('openssl czyta nasz certyfikat i potwierdza podpis', (t) => {
    if (!czyOpenssl()) return t.skip('brak openssl — trzecia opinia niedostępna');
    const dir = mkdtempSync(join(tmpdir(), 'rd-cert-'));
    try {
      const { cert } = wystawCertyfikat(DANE);
      const plik = join(dir, 'cert.pem');
      writeFileSync(plik, cert);
      const opis = execFileSync('openssl', ['x509', '-in', plik, '-noout', '-text'],
        { encoding: 'utf8' });
      assert.match(opis, /Version: 3/);
      assert.match(opis, /sha256WithRSAEncryption/);
      assert.match(opis, /CA:FALSE/);
      assert.match(opis, /TLS Web Server Authentication/);
      assert.match(opis, /DNS:localhost/);
      assert.match(opis, /IP Address:192\.168\.8\.50/);
      const w = execFileSync('openssl', ['verify', '-CAfile', plik, plik], { encoding: 'utf8' });
      assert.match(w, /OK/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    return undefined;
  });
});

describe('wpięcie w mostek', () => {
  test('bez openssl-a mostek NIE odmawia już nasłuchu', () => {
    // To była cała przyczyna zgłoszenia z Windowsa 2026-09-08.
    const dir = mkdtempSync(join(tmpdir(), 'rd-tlsw-'));
    try {
      const tlsInfo = przygotujCertyfikat({
        cfg: { api: { tls: {} } }, dataDir: dir, wymusWlasny: true,
      });
      assert.ok(tlsInfo, 'certyfikat miał zostać wystawiony bez openssl-a');
      assert.equal(tlsInfo.wlasnym, true, 'ma iść naszą drogą');
      const x = new X509Certificate(readFileSync(tlsInfo.cert));
      assert.ok(x.checkIP('127.0.0.1'), 'localhost musi być w SAN');
      // Klucz prywatny to sekret — prawa jak przy pin.env.
      assert.equal(statSync(tlsInfo.key).mode & 0o777, 0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('gdy openssl JEST, ale zawiedzie, wchodzi własny koder', () => {
    // Realny przypadek: openssl starszy niż 1.1.1 nie zna `-addext`, bywa też
    // brak `openssl.cnf`. Podstawiamy w PATH `openssl`, które zawsze pada —
    // wersję zgłasza poprawnie (czyOpenssl() widzi narzędzie), a wystawienie
    // certyfikatu odrzuca. Mostek ma to przeżyć, nie odmówić nasłuchu.
    if (process.platform === 'win32') return; // podmiana PATH-a inaczej działa
    const dir = mkdtempSync(join(tmpdir(), 'rd-tlsx-'));
    const kosz = mkdtempSync(join(tmpdir(), 'rd-bin-'));
    const staryPath = process.env.PATH;
    try {
      const atrapa = join(kosz, 'openssl');
      writeFileSync(atrapa, '#!/bin/sh\n'
        + 'case "$1" in version) echo "OpenSSL 0.9.8 atrapa"; exit 0;; esac\n'
        + 'echo "unknown option -addext" >&2; exit 1\n', { mode: 0o755 });
      process.env.PATH = kosz;
      assert.equal(czyOpenssl(), true, 'atrapa ma być widziana jako openssl');

      const tlsInfo = przygotujCertyfikat({ cfg: { api: { tls: {} } }, dataDir: dir });
      assert.ok(tlsInfo, 'awaria openssl-a nie może kończyć się odmową');
      assert.equal(tlsInfo.wlasnym, true, 'zapasem jest wbudowany koder');
      const x = new X509Certificate(readFileSync(tlsInfo.cert));
      assert.ok(x.checkHost('localhost'), 'certyfikat z zapasu musi być użyteczny');
    } finally {
      process.env.PATH = staryPath;
      rmSync(dir, { recursive: true, force: true });
      rmSync(kosz, { recursive: true, force: true });
    }
    return undefined;
  });

  test('istniejący certyfikat nie jest nadpisywany', () => {
    // Inaczej każdy restart zmieniałby odcisk i przeglądarka pytałaby od nowa.
    const dir = mkdtempSync(join(tmpdir(), 'rd-tlsp-'));
    try {
      const a = przygotujCertyfikat({ cfg: { api: { tls: {} } }, dataDir: dir, wymusWlasny: true });
      const pierwszy = readFileSync(a.cert, 'utf8');
      const b = przygotujCertyfikat({ cfg: { api: { tls: {} } }, dataDir: dir, wymusWlasny: true });
      assert.equal(b.wystawiony, false, 'drugie wywołanie ma tylko wskazać istniejący');
      assert.equal(readFileSync(b.cert, 'utf8'), pierwszy);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
