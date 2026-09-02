// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Pozycja w menu środowiska graficznego (Linux).
//
// REGRESJA 2026-09-01: po instalacji .deb program nie pojawiał się w menu XFCE.
// Przyczyna: `Categories=HamRadio;`. Wg specyfikacji freedesktop HamRadio to
// kategoria DODATKOWA i sama nie przypisuje wpisu do żadnej gałęzi menu —
// w XFCE ląduje wtedy najwyżej w koszu „Inne", a przy menu bez sekcji
// na nieprzypisane znika zupełnie. Sprawdzone rozstrzygnięciem plików
// xfce-applications.menu i gnome-applications.menu.
//
// Tego nie da się złapać testem jednostkowym kodu — usterka siedzi wyłącznie
// w konfiguracji pakowania, więc test pilnuje konfiguracji.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = yaml.load(readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

// Kategorie główne wg specyfikacji freedesktop — tylko one wpinają wpis do menu.
const MAIN = new Set([
  'AudioVideo', 'Audio', 'Video', 'Development', 'Education', 'Game',
  'Graphics', 'Network', 'Office', 'Science', 'Settings', 'System', 'Utility',
]);

describe('wpis .desktop dla Linuksa', () => {
  test('kategorie zawierają kategorię główną', () => {
    const cats = String(cfg.linux.category).split(';').filter(Boolean);
    const main = cats.filter((c) => MAIN.has(c));
    assert.ok(
      main.length > 0,
      `Categories=${cfg.linux.category} nie ma kategorii głównej — wpis nie trafi do menu. ` +
      `Dozwolone: ${[...MAIN].join(', ')}`,
    );
  });

  test('HamRadio występuje razem z Network albo Audio', () => {
    // Specyfikacja dopuszcza HamRadio tylko przy tych dwóch; inne połączenie
    // przechodzi walidację menu, ale desktop-file-validate zgłasza zastrzeżenie.
    const cats = String(cfg.linux.category).split(';').filter(Boolean);
    if (!cats.includes('HamRadio')) return;
    assert.ok(
      cats.includes('Network') || cats.includes('Audio'),
      `HamRadio wymaga Network albo Audio, jest: ${cats.join(';')}`,
    );
  });

  test('opis nadaje się na dymek w menu', () => {
    // linux.description trafia jednocześnie do opisu pakietu i do pola Comment
    // w .desktop; electron-builder nadpisuje nim Comment PO scaleniu
    // desktop.entry, więc nie da się tego rozdzielić. Akapit w dymku to błąd.
    const d = String(cfg.linux.description).trim();
    assert.ok(d.length > 0, 'brak opisu');
    assert.ok(d.length <= 120, `opis ma ${d.length} znaków — w dymku menu będzie akapit`);
    assert.ok(!d.includes('\n'), 'opis nie może być wielolinijkowy');
  });

  test('okno da się skojarzyć z pozycją w menu', () => {
    // Zmierzone: WM_CLASS okna to "radiodyplom-bridge". StartupWMClass bierze się
    // z desktopName, a bez syncDesktopName electron-builder wpisuje tam
    // productName ("RadioDyplom Bridge") — i skojarzenie nie działa.
    assert.equal(cfg.linux.syncDesktopName, true, 'brak linux.syncDesktopName: true');
    assert.ok(pkg.desktopName, 'brak desktopName w package.json');
    assert.match(pkg.desktopName, /\.desktop$/);
    assert.equal(pkg.desktopName.replace(/\.desktop$/, ''), pkg.name,
      'desktopName ma się zgadzać z nazwą pliku wykonywalnego');
  });

  test('słowa kluczowe kończą się średnikiem', () => {
    // Lista w .desktop musi być zakończona średnikiem, inaczej ostatni wyraz
    // bywa pomijany przez wyszukiwarki menu.
    const kw = cfg.linux.desktop?.entry?.Keywords;
    if (kw === undefined) return;
    assert.match(String(kw), /;$/);
  });
});
