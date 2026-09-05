// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Pakiet bez interfejsu (Raspberry Pi i inne maszyny bez monitora).
//
// Testujemy PLIKI ŹRÓDŁOWE pakietu, a nie zbudowaną paczkę: budowanie wymaga
// `dpkg-deb`, którego nie ma na każdym systemie, a błędy i tak siedzą
// w jednostce systemd i w metadanych — nie w samym pakowaniu.
//
// Po co: te rzeczy nie wychodzą na żadnym teście jednostkowym ani przy
// uruchomieniu z katalogu projektu. Wychodzą dopiero na cudzej malince.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UNIT = readFileSync(join(ROOT, 'dist', 'radiodyplom-bridge.service'), 'utf8');
const BUILD = readFileSync(join(ROOT, 'src', 'tools', 'build-headless-deb.js'), 'utf8');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** Wartość dyrektywy z pliku jednostki. */
const dyrektywa = (nazwa) => {
  const m = new RegExp(`^${nazwa}=(.*)$`, 'm').exec(UNIT);
  return m ? m[1].trim() : null;
};

describe('usługa systemd', () => {
  test('nie działa z prawami roota', () => {
    // Mostek przyjmuje dane z sieci. Nie ma powodu, żeby robił to jako root.
    assert.equal(dyrektywa('User'), 'radiodyplom');
    assert.equal(dyrektywa('Group'), 'radiodyplom');
    assert.equal(dyrektywa('NoNewPrivileges'), 'true');
  });

  test('uruchamia program przez skrypt, nie przez `node` wprost', () => {
    // W Debianie binarka bywa `node` ALBO `nodejs` — nazwa `node` była tam
    // zajęta przez pakiet krótkofalarski. Sztywne /usr/bin/node wywaliłoby
    // usługę na części systemów.
    const exec = dyrektywa('ExecStart');
    assert.equal(exec, '/usr/bin/radiodyplom-bridge-headless');
    assert.ok(!/\/usr\/bin\/node(js)?\b/.test(exec), 'żadnego sztywnego node w ExecStart');
  });

  test('konfiguracja z /etc, nie z katalogu programu', () => {
    assert.match(UNIT, /^Environment=RD_CONFIG_DIR=\/etc\/radiodyplom-bridge$/m);
  });

  test('PIN wczytywany z osobnego pliku, którego brak NIE jest błędem', () => {
    // Myślnik przed ścieżką: bez niego usługa nie wstałaby u kogoś, kto woli
    // trzymać PIN w config.json.
    assert.match(UNIT, /^EnvironmentFile=-\/etc\/radiodyplom-bridge\/pin\.env$/m);
  });

  test('katalog danych zakładany przez systemd', () => {
    // StateDirectory tworzy /var/lib/… z właściwym właścicielem. Bez tego
    // usługa z ProtectSystem=strict nie miałaby gdzie zapisać kolejki.
    assert.equal(dyrektywa('StateDirectory'), 'radiodyplom-bridge');
    assert.equal(dyrektywa('ProtectSystem'), 'strict');
  });

  test('wstaje sama po awarii', () => {
    assert.equal(dyrektywa('Restart'), 'on-failure');
    assert.equal(dyrektywa('WantedBy'), 'multi-user.target');
  });
});

describe('metadane pakietu', () => {
  test('Architecture: all — jedna paczka na arm64, armhf i amd64', () => {
    // To nie jest skrót: rdzeń nie ma zależności runtime ani kodu natywnego.
    assert.match(BUILD, /^Architecture: all$/m);
    assert.deepEqual(PKG.dependencies ?? {}, {},
      'gdyby doszła zależność runtime, `Architecture: all` przestałoby być prawdą');
  });

  test('wymaga Node zgodnego z engines', () => {
    assert.match(BUILD, /Depends: nodejs \(>= 18\)/);
    assert.equal(PKG.engines?.node, '>=18', 'deklaracja w paczce i w package.json muszą się zgadzać');
  });

  test('paczka nie niesie Electrona', () => {
    // Cały sens tego pakietu: 64 kB zamiast 94 MB.
    assert.ok(!/electron/i.test(BUILD.replace(/^.*(?:electron-builder|bez Electrona|Electrona).*$/gm, '')),
      'żadnego kopiowania Electrona do pakietu');
  });
});

describe('skrypty instalacyjne', () => {
  test('nie nadpisują istniejącej konfiguracji ani PIN-u', () => {
    // Aktualizacja pakietu nie może skasować ustawień użytkownika.
    assert.match(BUILD, /if \[ ! -f "\$KATALOG_KONF\/config\.json" \]/);
    assert.match(BUILD, /if \[ ! -f "\$KATALOG_KONF\/pin\.env" \]/);
  });

  test('PIN dostaje ciaśniejsze prawa niż konfiguracja', () => {
    assert.match(BUILD, /chmod 0640 "\$KATALOG_KONF\/pin\.env"/);
    assert.match(BUILD, /chmod 0644 "\$KATALOG_KONF\/config\.json"/);
  });

  test('instalacja NIE uruchamia usługi sama', () => {
    // Bez PIN-u usługa i tak nic nie zrobi, a błąd w logu tuż po instalacji
    // wygląda jak awaria pakietu.
    assert.ok(!/systemctl (enable|start) radiodyplom/.test(BUILD),
      'żadnego automatycznego enable/start w postinst');
  });

  test('purge kasuje PIN, ale ZOSTAWIA dziennik QSO', () => {
    // Historia pracy w eterze nie może zniknąć przy odinstalowaniu programu.
    assert.match(BUILD, /rm -rf \/etc\/radiodyplom-bridge/);

    // Szukamy WYKONANIA `rm`, a nie wzmianki o nim: postrm podpowiada
    // użytkownikowi ręczne usunięcie danych i ta podpowiedź ma zostać.
    // (Pierwsza wersja tego testu wywracała się właśnie na `echo`.)
    const wykonania = (BUILD.match(/^\s*rm -rf \/var\/lib\/radiodyplom-bridge/gm) || []);
    assert.deepEqual(wykonania, [], 'purge nie ma prawa kasować danych QSO');
    assert.match(BUILD, /Zostawiam dane QSO/, 'i ma o tym powiedzieć');
  });
});
