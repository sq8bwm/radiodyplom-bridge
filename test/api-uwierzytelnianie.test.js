// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Uwierzytelnianie, CSRF, tryb tylko do odczytu i reguły nasłuchu w sieci.
//
// To jest kod, którego pomyłka nie jest usterką, a dziurą: przez `POST
// /api/config` można podmienić PIN i przekierować cudze QSO. Dlatego testy
// idą po WSZYSTKICH bramkach, także po tych, które „przecież nie mogą zawieść".
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { StatusApi } from '../src/httpapi.js';
import {
  zahaszujHaslo, sprawdzHaslo, hasloUstawione, Sesje, Blokada, SESJA_MS,
  ciastkoSesji, odczytajCiastko, czyLokalny, trybApi, czyOpenssl,
} from '../src/apiauth.js';
import { setLevel } from '../src/log.js';

setLevel('error');

const HASLO = 'bardzo-tajne-haslo';
const PORT = 12779;
const base = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------- jednostkowe

describe('hasło', () => {
  test('hasz nie zawiera hasła, a sprawdzenie działa', () => {
    const h = zahaszujHaslo(HASLO);
    assert.ok(!h.includes(HASLO));
    assert.match(h, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    assert.equal(sprawdzHaslo(HASLO, h), true);
    assert.equal(sprawdzHaslo(HASLO + 'x', h), false);
    assert.equal(sprawdzHaslo('', h), false);
  });

  test('dwa hasze tego samego hasła są różne (sól)', () => {
    assert.notEqual(zahaszujHaslo(HASLO), zahaszujHaslo(HASLO));
  });

  test('krótkie hasło odrzucone', () => {
    assert.throws(() => zahaszujHaslo('krotkie'), /co najmniej 8/);
  });

  test('uszkodzony albo obcy hasz nie przechodzi', () => {
    for (const h of [null, '', 'scrypt$aa', 'md5$aa$bb', 'zupelnie-nie-hasz']) {
      assert.equal(sprawdzHaslo('cokolwiek', h), false, `hasz ${h}`);
    }
  });

  test('hasloUstawione rozpoznaje tylko prawdziwy hasz', () => {
    assert.equal(hasloUstawione({ api: { auth: { passwordHash: zahaszujHaslo(HASLO) } } }), true);
    assert.equal(hasloUstawione({ api: { auth: { passwordHash: 'WSTAW-HASLO' } } }), false);
    assert.equal(hasloUstawione({ api: {} }), false);
    assert.equal(hasloUstawione({}), false);
  });
});

describe('sesje i CSRF', () => {
  test('każda sesja ma inny identyfikator i inny token', () => {
    const s = new Sesje();
    const a = s.utworz(); const b = s.utworz();
    assert.notEqual(a.id, b.id);
    assert.notEqual(a.csrf, b.csrf);
    assert.equal(a.id.length, 64, '32 bajty losowe w hex');
  });

  test('sesja wygasa', () => {
    let teraz = 1000;
    const s = new Sesje({ teraz: () => teraz });
    const a = s.utworz();
    assert.ok(s.pobierz(a.id));
    teraz += SESJA_MS + 1;
    assert.equal(s.pobierz(a.id), null, 'po czasie sesja nie działa');
    assert.equal(s.ile(), 0, 'i jest usuwana z pamięci');
  });

  test('nieznany identyfikator nie daje sesji', () => {
    const s = new Sesje();
    s.utworz();
    assert.equal(s.pobierz('0'.repeat(64)), null);
    assert.equal(s.pobierz(''), null);
    assert.equal(s.pobierz(undefined), null);
  });

  test('ciasteczko: Secure tylko przy TLS, zawsze HttpOnly i SameSite', () => {
    const zTls = ciastkoSesji('ID', { tls: true });
    const bezTls = ciastkoSesji('ID', { tls: false });
    for (const c of [zTls, bezTls]) {
      assert.match(c, /HttpOnly/);
      assert.match(c, /SameSite=Strict/);
    }
    assert.match(zTls, /Secure/);
    assert.doesNotMatch(bezTls, /Secure/, 'bez TLS Secure zablokowałoby ciasteczko');
  });

  test('odczyt ciasteczka z nagłówka z wieloma wartościami', () => {
    assert.equal(odczytajCiastko('a=1; rdb_sesja=XYZ; b=2'), 'XYZ');
    assert.equal(odczytajCiastko('inne=1'), null);
    assert.equal(odczytajCiastko(''), null);
    assert.equal(odczytajCiastko(undefined), null);
  });
});

describe('blokada logowania', () => {
  test('blokuje po piątej nieudanej próbie i przedłuża karę', () => {
    let teraz = 0;
    const b = new Blokada({ teraz: () => teraz });
    for (let i = 0; i < 4; i += 1) {
      b.nieudana('1.2.3.4');
      assert.equal(b.ileCzekac('1.2.3.4'), 0, `po ${i + 1} próbie jeszcze wolno`);
    }
    b.nieudana('1.2.3.4');
    const pierwsza = b.ileCzekac('1.2.3.4');
    assert.ok(pierwsza > 0, 'piąta próba blokuje');

    teraz += pierwsza + 1;
    assert.equal(b.ileCzekac('1.2.3.4'), 0, 'po odczekaniu wolno znowu');
    for (let i = 0; i < 5; i += 1) b.nieudana('1.2.3.4');
    assert.ok(b.ileCzekac('1.2.3.4') > pierwsza, 'kolejna kara jest dłuższa');
  });

  test('blokada dotyczy jednego adresu, nie wszystkich', () => {
    const b = new Blokada();
    for (let i = 0; i < 5; i += 1) b.nieudana('1.2.3.4');
    assert.ok(b.ileCzekac('1.2.3.4') > 0);
    assert.equal(b.ileCzekac('5.6.7.8'), 0);
  });

  test('udane logowanie zeruje licznik', () => {
    const b = new Blokada();
    for (let i = 0; i < 4; i += 1) b.nieudana('1.2.3.4');
    b.udana('1.2.3.4');
    for (let i = 0; i < 4; i += 1) b.nieudana('1.2.3.4');
    assert.equal(b.ileCzekac('1.2.3.4'), 0, 'licznik zaczyna od zera');
  });
});

describe('reguły nasłuchu (fail-closed)', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'rd-tryb-'));
  after(() => rmSync(dataDir, { recursive: true, force: true }));

  const konf = (api) => ({ api: { port: 12061, ...api } });

  test('localhost: bez hasła, bez TLS, zapis dozwolony', () => {
    const t = trybApi({ cfg: konf({ host: '127.0.0.1' }), dataDir });
    assert.equal(t.siec, false);
    assert.equal(t.tls, null);
    assert.equal(t.readOnly, false);
  });

  test('każda postać localhosta liczy się jako lokalna', () => {
    for (const h of ['127.0.0.1', '::1', 'localhost', undefined]) {
      assert.equal(czyLokalny(h), true, `${h} ma być lokalne`);
    }
    for (const h of ['0.0.0.0', '192.168.1.10', '::']) {
      assert.equal(czyLokalny(h), false, `${h} NIE jest lokalne`);
    }
  });

  test('sieć BEZ hasła → zostaje na localhoście', () => {
    const t = trybApi({ cfg: konf({ host: '0.0.0.0' }), dataDir });
    assert.equal(t.host, '127.0.0.1');
    assert.equal(t.siec, false);
    assert.ok(t.powody.some((p) => /hasła/.test(p)), t.powody.join('; '));
  });

  test('sieć z hasłem, ale TLS wyłączony → zostaje na localhoście', () => {
    const t = trybApi({
      cfg: konf({
        host: '0.0.0.0',
        auth: { passwordHash: zahaszujHaslo(HASLO) },
        tls: { enabled: false },
      }),
      dataDir,
    });
    assert.equal(t.host, '127.0.0.1');
    assert.equal(t.siec, false);
    assert.ok(t.powody.some((p) => /TLS/.test(p)), t.powody.join('; '));
  });

  test('sieć z hasłem i TLS → wpuszcza, domyślnie TYLKO DO ODCZYTU', (t) => {
    if (!czyOpenssl()) return t.skip('brak openssl — nie ma czym wystawić certyfikatu');
    const tryb = trybApi({
      cfg: konf({ host: '0.0.0.0', auth: { passwordHash: zahaszujHaslo(HASLO) } }),
      dataDir,
    });
    assert.equal(tryb.host, '0.0.0.0');
    assert.equal(tryb.siec, true);
    assert.equal(tryb.readOnly, true, 'w sieci zapis wymaga jawnego readOnly:false');
    assert.ok(tryb.tls && existsSync(tryb.tls.cert) && existsSync(tryb.tls.key));
    return undefined;
  });

  test('readOnly:false w sieci jest respektowane, ale musi być jawne', (t) => {
    if (!czyOpenssl()) return t.skip('brak openssl');
    const tryb = trybApi({
      cfg: konf({
        host: '0.0.0.0', readOnly: false,
        auth: { passwordHash: zahaszujHaslo(HASLO) },
      }),
      dataDir,
    });
    assert.equal(tryb.readOnly, false);
    return undefined;
  });
});

// ------------------------------------------------------------------ po HTTP

describe('bramka na żywym serwerze', () => {
  let api;
  const cfg = {
    api: {
      enabled: true, port: PORT, host: '127.0.0.1',
      auth: { passwordHash: zahaszujHaslo(HASLO) },
    },
    udp: { host: '127.0.0.1', port: 12780, multicastGroups: [] },
    radiodyplom: { apiUrl: 'http://x/y', pin: 'AAAA-1111', dryRun: true },
    forward: { operations: ['insert'], targets: [] },
    queue: { maxAttempts: 20, journalDir: '/tmp/rd-brak-katalogu' },
    rateLimit: { maxPerMinute: 9, minSpacingMs: 700 },
    logLevel: 'error', ui: { recentEvents: 5 }, _pinMissing: false,
    _dataDir: mkdtempSync(join(tmpdir(), 'rd-gate-')),
  };

  before(async () => {
    api = new StatusApi({
      cfg,
      store: {
        counts: () => ({ pending: 0, failed: 0, sent: 1, dryRun: 0, skipped: 0 }),
        list: () => [], listFailed: () => [], unackedFailed: () => 0,
        ackFailed: () => 0, discardFailed: () => ({ removed: 0, calls: [] }),
      },
      listener: { host: '127.0.0.1', port: 12780, multicastGroups: [],
        stats: { received: 0, accepted: 0, skipped: 0, invalid: 0, unknown: 0,
          bySource: {}, skipReasons: {} } },
      worker: { paused: false, online: true,
        counters: { sent: 0, dryRun: 0, duplicates: 0, failed: 0, retries: 0 },
        lastSent: null, lastError: null, recentEvents: () => [],
        pause() { this.paused = true; }, resume() { this.paused = false; } },
      pkg: { name: 'x', version: '9.9.9', license: 'GPL-3.0-or-later' },
      getPing: () => ({ ok: true, operator: 'SQ8BWM', stations: [], activeActions: [] }),
      requeue: () => 0,
      getConfig: () => ({ ui: { recentEvents: 5 } }),
      saveConfig: () => ({ saved: true, restartRequired: [], path: '/tmp/x' }),
      getPendingRestart: () => [], getUpdate: () => null,
      getLogFile: () => '/tmp/x.log', getAccountChecks: () => [],
      checkConfig: async () => [],
    });
    assert.equal(await api.start(), true);
  });

  after(() => {
    api.stop();
    rmSync(cfg._dataDir, { recursive: true, force: true });
  });

  test('bez sesji: API oddaje 401, a strona formularz logowania', async () => {
    assert.equal((await fetch(`${base}/api/status`)).status, 401);
    const strona = await fetch(`${base}/`);
    assert.equal(strona.status, 200);
    const html = await strona.text();
    assert.match(html, /id="p"/, 'ma być pole na hasło, nie interfejs');
    // Szukamy WCZYTANIA interfejsu, nie wzmianki o nim: strona logowania
    // wspomina renderer.js w komentarzu wyjaśniającym, czego nie ładuje.
    assert.doesNotMatch(html, /<script[^>]+src=/,
      'przed logowaniem strona nie może wczytywać żadnego skryptu z serwera');
  });

  test('/api/session jest dostępne bez logowania i nic nie zdradza', async () => {
    const s = await (await fetch(`${base}/api/session`)).json();
    assert.equal(s.wymagaLogowania, true);
    assert.equal(s.zalogowany, false);
    assert.equal(s.csrf, null, 'token CSRF wydajemy tylko po zalogowaniu');
    assert.equal(JSON.stringify(s).includes('scrypt$'), false);
  });

  test('złe hasło nie loguje', async () => {
    const r = await fetch(`${base}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'nie-to' }),
    });
    assert.equal(r.status, 401);
    assert.equal(r.headers.get('set-cookie'), null, 'brak ciasteczka przy nieudanym logowaniu');
  });

  test('dobre hasło daje ciasteczko i token, a potem dostęp', async () => {
    const r = await fetch(`${base}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: HASLO }),
    });
    assert.equal(r.status, 200);
    const ciastko = r.headers.get('set-cookie');
    assert.match(ciastko, /rdb_sesja=/);
    assert.match(ciastko, /HttpOnly/);
    const { csrf } = await r.json();
    assert.equal(typeof csrf, 'string');

    const naglowki = { Cookie: ciastko.split(';')[0] };
    assert.equal((await fetch(`${base}/api/status`, { headers: naglowki })).status, 200);

    // POST bez tokenu — odrzucony, choć sesja jest poprawna.
    const bezTokenu = await fetch(`${base}/api/pause`, { method: 'POST', headers: naglowki });
    assert.equal(bezTokenu.status, 403);
    assert.match((await bezTokenu.json()).error, /CSRF/);

    // POST z cudzym tokenem — też odrzucony.
    const zlyToken = await fetch(`${base}/api/pause`, {
      method: 'POST', headers: { ...naglowki, 'X-CSRF-Token': '0'.repeat(64) },
    });
    assert.equal(zlyToken.status, 403);

    // POST z właściwym tokenem — przechodzi (localhost, więc zapis wolny).
    const dobry = await fetch(`${base}/api/pause`, {
      method: 'POST', headers: { ...naglowki, 'X-CSRF-Token': csrf },
    });
    assert.equal(dobry.status, 200);

    // Wylogowanie unieważnia sesję.
    await fetch(`${base}/api/logout`, {
      method: 'POST', headers: { ...naglowki, 'X-CSRF-Token': csrf },
    });
    assert.equal((await fetch(`${base}/api/status`, { headers: naglowki })).status, 401);
  });

  test('status niesie tryb pracy, ale nigdy hasła', async () => {
    const r = await fetch(`${base}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: HASLO }),
    });
    const ciastko = r.headers.get('set-cookie').split(';')[0];
    const s = await (await fetch(`${base}/api/status`, { headers: { Cookie: ciastko } })).json();
    assert.equal(s.api.wymagaLogowania, true);
    assert.equal(s.api.siec, false);
    assert.equal(s.api.tylkoOdczyt, false);
    assert.equal(JSON.stringify(s).includes('scrypt$'), false, 'hasz nie może wyjść w statusie');
  });

  test('tryb tylko do odczytu odrzuca każdy POST', async () => {
    const r = await fetch(`${base}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: HASLO }),
    });
    const ciastko = r.headers.get('set-cookie').split(';')[0];
    const { csrf } = await r.json();
    const naglowki = { Cookie: ciastko, 'X-CSRF-Token': csrf };

    api.tryb.readOnly = true;                 // tak jak przy nasłuchu w sieci
    try {
      for (const sciezka of ['/api/pause', '/api/resume', '/api/requeue',
        '/api/failed/discard', '/api/problems/ack', '/api/config']) {
        const odp = await fetch(base + sciezka, { method: 'POST', headers: naglowki });
        assert.equal(odp.status, 403, `${sciezka} musi być odrzucone`);
        assert.match((await odp.json()).error, /tylko do odczytu/);
      }
      // Czytanie nadal działa — o to w tym trybie chodzi.
      assert.equal((await fetch(`${base}/api/status`, { headers: { Cookie: ciastko } })).status, 200);
    } finally {
      api.tryb.readOnly = false;
    }
  });
});
