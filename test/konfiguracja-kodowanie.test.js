// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Konfiguracja zapisana przez edytor z Windowsa.
//
// ZGŁOSZENIE 2026-10-05, odtworzone na prawdziwym Windowsie 11: plik zapisany
// „UTF-8 z BOM" kładł rdzeń komunikatem o nieprawidłowym JSON-ie:
//
//   Nie mogę wczytać konfiguracji (…config.json):
//   Unexpected token '?', "?{ "u"... is not valid JSON
//
// Robi tak PowerShell (`Set-Content -Encoding UTF8`) i Notatnik przy wyborze
// „UTF-8 z BOM", więc wystarczy, że ktoś RAZ zajrzy do pliku w edytorze i go
// zapisze. Dla człowieka plik wygląda potem identycznie — nic nie ostrzeże,
// a program przestaje wstawać.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import dgram from 'node:dgram';

import { bezBom, loadConfig, examplePath } from '../src/config.js';
import { writeConfigFile } from '../src/configedit.js';
import { dostosujPortyPrzyZasiewie } from '../src/instalacja.js';
import { setLevel } from '../src/log.js';
import { wolnyPortTcp } from './pomoc-porty.js';

setLevel('error');

const kosze = [];
const kosz = () => {
  const d = mkdtempSync(join(tmpdir(), 'rd-bom-'));
  kosze.push(d);
  return d;
};
after(() => kosze.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Zapisuje obiekt jako JSON poprzedzony znacznikiem „UTF-8 z BOM". */
function zapiszZBomem(plik, obiekt) {
  writeFileSync(plik, Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(JSON.stringify(obiekt, null, 2), 'utf8'),
  ]));
}

/** Uruchamia `fn` z podstawionym RD_CONFIG_DIR i sprząta po sobie. */
function wKatalogu(dir, fn) {
  const stare = process.env.RD_CONFIG_DIR;
  process.env.RD_CONFIG_DIR = dir;
  try { return fn(); } finally {
    if (stare === undefined) delete process.env.RD_CONFIG_DIR;
    else process.env.RD_CONFIG_DIR = stare;
  }
}

describe('plik konfiguracji z BOM-em', () => {
  test('wczytuje się normalnie, zamiast kłaść rdzeń', () => {
    const dir = kosz();
    const wzor = JSON.parse(readFileSync(examplePath(), 'utf8'));
    writeFileSync(join(dir, 'config.json'), Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(JSON.stringify(wzor, null, 2), 'utf8'),
    ]));

    const cfg = wKatalogu(dir, () => loadConfig());
    assert.equal(cfg.udp.port, wzor.udp.port);
  });

  test('plik bez BOM-u zostaje nietknięty', () => {
    assert.equal(bezBom(Buffer.from('{"a":1}')), '{"a":1}');
  });

  test('UTF-16 mówi o KODOWANIU, nie o nieprawidłowym JSON-ie', () => {
    // Obcięcie znacznika tu nie wystarczy — cała treść jest w innym kodowaniu.
    // Komunikat musi prowadzić do rozwiązania; „not valid JSON" prowadzi donikąd.
    assert.throws(() => bezBom(Buffer.from([0xff, 0xfe, 0x7b, 0x00])), /UTF-16 LE/);
    assert.throws(() => bezBom(Buffer.from([0xfe, 0xff, 0x00, 0x7b])), /UTF-16 BE/);
  });

  test('komunikat o UTF-16 dociera aż do użytkownika, z nazwą pliku', () => {
    const dir = kosz();
    writeFileSync(join(dir, 'config.json'), Buffer.from([0xff, 0xfe, 0x7b, 0x00]));
    assert.throws(
      () => wKatalogu(dir, () => loadConfig()),
      (err) => {
        assert.match(err.message, /Nie mogę wczytać konfiguracji/);
        assert.match(err.message, /config\.json/, 'ma być widać, KTÓRY plik');
        assert.match(err.message, /UTF-16/, 'i co z nim jest nie tak');
        return true;
      },
    );
  });
});

describe('BOM w pozostałych miejscach, które czytają config.json', () => {
  test('zapis z interfejsu NIE gubi kluczy, których UI nie zna', () => {
    // Bez obsługi BOM-u `writeConfigFile` nie wczytuje pliku, zaczyna od pustego
    // obiektu i zostawia wyłącznie pola z własnej listy — czyli jeden zapis
    // z okna kasuje m.in. `logFile`. Nic o tym nie mówi: zapis się udaje.
    const dir = kosz();
    const wzor = JSON.parse(readFileSync(examplePath(), 'utf8'));
    wzor.logFile = '/tmp/moj-wlasny.log';
    zapiszZBomem(join(dir, 'config.json'), wzor);

    wKatalogu(dir, () => writeConfigFile(loadConfig()));

    const po = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
    assert.equal(po.logFile, '/tmp/moj-wlasny.log');
  });

  test('zasiew przestawia zajęty port także w pliku z BOM-em', async () => {
    // Tu BOM nie kładł programu, tylko cicho wyłączał ochronę portów: plik był
    // „nieczytelny", więc funkcja kończyła się na `return null` i mostek
    // startował na porcie, który ktoś już trzyma.
    const dir = kosz();
    const zajety = dgram.createSocket('udp4');
    await new Promise((g) => zajety.bind({ address: '127.0.0.1', port: 0 }, g));
    const port = zajety.address().port;

    const wzor = JSON.parse(readFileSync(examplePath(), 'utf8'));
    wzor.udp = { ...wzor.udp, host: '127.0.0.1', port, enabled: true };
    wzor.api = { ...wzor.api, port: await wolnyPortTcp() };
    const plik = join(dir, 'config.json');
    zapiszZBomem(plik, wzor);

    try {
      const wynik = await dostosujPortyPrzyZasiewie(plik);
      assert.ok(wynik, 'zajęty port miał zostać przestawiony, a nie zignorowany');
      assert.ok(wynik.zmienione.includes('udp'));
      assert.notEqual(wynik.udp, port);
    } finally {
      zajety.close();
    }
  });
});
