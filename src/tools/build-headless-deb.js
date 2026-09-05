#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Buduje pakiet .deb z samym rdzeniem — bez interfejsu, bez Electrona.
//
//   npm run pack:headless
//
// Po co osobny pakiet, skoro jest już .deb z aplikacją: tamten waży 94 MB, bo
// niesie całego Electrona, i wymaga środowiska graficznego. Na Raspberry Pi
// pracującym bez monitora ani jedno, ani drugie nie ma sensu.
//
// `Architecture: all` nie jest skrótem — rdzeń to czysty JavaScript BEZ ŻADNYCH
// zależności runtime, więc ta sama paczka działa na arm64, armhf i amd64.
// To jest wymierny zysk z decyzji o zerowych zależnościach.
import { execFileSync } from 'node:child_process';
import {
  cpSync, mkdirSync, rmSync, writeFileSync, chmodSync, readFileSync, existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const NAZWA = 'radiodyplom-bridge-headless';
const WERSJA = pkg.version;
const OUT = join(ROOT, 'release');
const BUDOWA = join(OUT, `${NAZWA}_${WERSJA}`);

// `dpkg-deb` nie jest w Node — bez niego nie ma czego budować.
try {
  execFileSync('dpkg-deb', ['--version'], { stdio: 'ignore' });
} catch {
  console.error('Potrzebny jest `dpkg-deb` (pakiet dpkg-dev). Na nie-Debianie paczki nie zbuduję.');
  process.exit(1);
}

rmSync(BUDOWA, { recursive: true, force: true });
const kat = (...p) => {
  const d = join(BUDOWA, ...p);
  mkdirSync(d, { recursive: true });
  return d;
};

// --- program: sam rdzeń i to, czego potrzebuje do startu ---
const lib = kat('usr', 'lib', 'radiodyplom-bridge');
cpSync(join(ROOT, 'src'), join(lib, 'src'), { recursive: true });
// package.json jest czytany w czasie pracy (wersja w /api/status, adres
// repozytorium do sprawdzania aktualizacji), więc musi być w paczce.
writeFileSync(join(lib, 'package.json'), JSON.stringify({
  name: pkg.name,
  version: pkg.version,
  type: pkg.type,
  license: pkg.license,
  author: pkg.author,
  repository: pkg.repository,
}, null, 2) + '\n');
cpSync(join(ROOT, 'config.example.json'), join(lib, 'config.example.json'));

// --- uruchamianie ---
// Własny skrypt zamiast wołania node wprost: w Debianie binarka bywa `node`
// albo `nodejs` (nazwa `node` była tam zajęta przez pakiet krótkofalarski),
// a przy braku Node chcemy zrozumiałego komunikatu, nie „No such file".
const bin = kat('usr', 'bin');
writeFileSync(join(bin, 'radiodyplom-bridge-headless'), `#!/bin/sh
set -e
for kandydat in node nodejs; do
  if command -v "$kandydat" >/dev/null 2>&1; then
    exec "$kandydat" /usr/lib/radiodyplom-bridge/src/index.js "$@"
  fi
done
echo "Nie znalazłem Node.js (szukałam poleceń: node, nodejs)." >&2
echo "Zainstaluj: sudo apt install nodejs   (wymagana wersja 18 lub nowsza)" >&2
exit 1
`);
chmodSync(join(bin, 'radiodyplom-bridge-headless'), 0o755);

// --- usługa systemd ---
const unit = kat('lib', 'systemd', 'system');
cpSync(join(ROOT, 'dist', 'radiodyplom-bridge.service'),
  join(unit, 'radiodyplom-bridge.service'));

// --- dokumentacja i licencja (wymagane przez politykę Debiana) ---
const doc = kat('usr', 'share', 'doc', NAZWA);
cpSync(join(ROOT, 'LICENSE'), join(doc, 'copyright'));
for (const f of ['README.md']) cpSync(join(ROOT, f), join(doc, f));
if (existsSync(join(ROOT, 'docs', 'malinka.md'))) {
  cpSync(join(ROOT, 'docs', 'malinka.md'), join(doc, 'malinka.md'));
}

// --- metadane pakietu ---
const debian = kat('DEBIAN');
writeFileSync(join(debian, 'control'), `Package: ${NAZWA}
Version: ${WERSJA}
Architecture: all
Maintainer: ${typeof pkg.author === 'string' ? pkg.author : pkg.author?.name} <sq8bwm@gmail.com>
Depends: nodejs (>= 18)
Section: hamradio
Priority: optional
Homepage: ${pkg.repository?.url || pkg.repository}
Description: Mostek QSO logger -> radiodyplom.pl (bez interfejsu)
 Przekazuje zalogowane QSO z loggera (QLog, N1MM, WSJT-X) na radiodyplom.pl.
 Wersja bez interfejsu graficznego, do pracy jako usluga systemowa - na
 Raspberry Pi albo dowolnym komputerze bez monitora.
 .
 Sam rdzen to czysty JavaScript bez zaleznosci, wiec ta sama paczka dziala
 na arm64, armhf i amd64.
`);

// Konfiguracji NIE deklarujemy jako conffile: tworzy ją postinst z przykładu,
// więc dpkg nie ma jej w oryginale i nie miałby czego porównywać.
writeFileSync(join(debian, 'postinst'), `#!/bin/sh
set -e

KATALOG_KONF=/etc/radiodyplom-bridge

if [ "$1" = "configure" ]; then
  # Konto systemowe bez powłoki i bez katalogu domowego — usłudze wystarczy
  # katalog stanu, który systemd tworzy sam (StateDirectory).
  if ! getent passwd radiodyplom >/dev/null; then
    adduser --system --group --no-create-home \\
            --home /var/lib/radiodyplom-bridge \\
            --gecos "Mostek QSO radiodyplom" radiodyplom >/dev/null
  fi

  mkdir -p "$KATALOG_KONF"

  # Konfiguracji NIE nadpisujemy przy aktualizacji — to ustawienia użytkownika.
  if [ ! -f "$KATALOG_KONF/config.json" ]; then
    sed -e 's|"dataDir": "auto"|"dataDir": "/var/lib/radiodyplom-bridge"|' \\
        -e 's|"pin": "WSTAW-PIN"|"pin": ""|' \\
        -e 's|"dryRun": true|"dryRun": false|' \\
        /usr/lib/radiodyplom-bridge/config.example.json > "$KATALOG_KONF/config.json"
    chown root:radiodyplom "$KATALOG_KONF/config.json"
    chmod 0644 "$KATALOG_KONF/config.json"
  fi

  # PIN osobno, z ciaśniejszymi prawami: config.json bywa wklejany do zgłoszeń
  # błędów, a sekret nie ma prawa się tak rozejść.
  if [ ! -f "$KATALOG_KONF/pin.env" ]; then
    cat > "$KATALOG_KONF/pin.env" <<'EOF'
# PIN API z radiodyplom.pl. Bez cudzysłowów, bez spacji wokół znaku równości.
# Po zmianie: sudo systemctl restart radiodyplom-bridge
RD_PIN=
EOF
    chown root:radiodyplom "$KATALOG_KONF/pin.env"
    chmod 0640 "$KATALOG_KONF/pin.env"
  fi

  if [ -d /run/systemd/system ]; then
    systemctl daemon-reload || true
  fi

  # Świadomie NIE uruchamiamy usługi: bez PIN-u i tak nic nie zrobi, a start
  # bez konfiguracji zostawiłby w logu błąd wyglądający na awarię instalacji.
  echo ""
  echo "  Zainstalowano ${NAZWA} ${WERSJA}."
  echo ""
  echo "  1. Wpisz PIN:      sudo nano $KATALOG_KONF/pin.env"
  echo "  2. Sprawdź ustawienia (adres nasłuchu, cele):"
  echo "                     sudo nano $KATALOG_KONF/config.json"
  echo "  3. Uruchom:        sudo systemctl enable --now radiodyplom-bridge"
  echo "  4. Sprawdź:        systemctl status radiodyplom-bridge"
  echo "                     curl -s localhost:12061/api/status"
  echo ""
  echo "  Opis krok po kroku: /usr/share/doc/${NAZWA}/malinka.md"
  echo ""
fi

exit 0
`);
chmodSync(join(debian, 'postinst'), 0o755);

writeFileSync(join(debian, 'prerm'), `#!/bin/sh
set -e
if [ "$1" = "remove" ] && [ -d /run/systemd/system ]; then
  systemctl stop radiodyplom-bridge >/dev/null 2>&1 || true
  systemctl disable radiodyplom-bridge >/dev/null 2>&1 || true
fi
exit 0
`);
chmodSync(join(debian, 'prerm'), 0o755);

writeFileSync(join(debian, 'postrm'), `#!/bin/sh
set -e
if [ -d /run/systemd/system ]; then
  systemctl daemon-reload >/dev/null 2>&1 || true
fi

if [ "$1" = "purge" ]; then
  # Konfiguracja razem z PIN-em znika — sekret nie ma zostawać po odinstalowaniu.
  rm -rf /etc/radiodyplom-bridge
  # DANE ZOSTAJĄ. W /var/lib leży kolejka i dziennik wysłanych QSO, czyli
  # historia pracy w eterze. Kasowanie jej przy odinstalowaniu programu byłoby
  # stratą nie do odzyskania, a użytkownik nie ma jak tego przewidzieć.
  if [ -d /var/lib/radiodyplom-bridge ]; then
    echo "Zostawiam dane QSO w /var/lib/radiodyplom-bridge (dziennik i kolejka)."
    echo "Do usunięcia ręcznie: sudo rm -rf /var/lib/radiodyplom-bridge"
  fi
fi
exit 0
`);
chmodSync(join(debian, 'postrm'), 0o755);

// --- budowa ---
mkdirSync(OUT, { recursive: true });
const plik = join(OUT, `${NAZWA}_${WERSJA}_all.deb`);
execFileSync('dpkg-deb', ['--build', '--root-owner-group', BUDOWA, plik], { stdio: 'inherit' });
rmSync(BUDOWA, { recursive: true, force: true });

const rozmiar = readFileSync(plik).length;
console.log(`\nZbudowano: ${plik}`);
console.log(`Rozmiar:   ${(rozmiar / 1024).toFixed(0)} kB`);
