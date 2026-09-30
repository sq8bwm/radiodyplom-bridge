#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Udaje Logger32: łączy się po TCP i wysyła rekord ADIF, tak jak robi to
// funkcja „enable QSO export by TCP" — jedno połączenie na QSO, zamykane po
// wysłaniu.
//
// Po co: Logger32 działa tylko na Windowsie, a nasłuch trzeba dać się sprawdzić
// bez niego — i przy zgłoszeniu błędu poprosić zgłaszającego o to samo jednym
// poleceniem, zamiast o opis „u mnie nie działa".
//
// Użycie:
//   node src/tools/symuluj-logger32.js                      # jedno QSO na 127.0.0.1:52005
//   node src/tools/symuluj-logger32.js --port 52005 --host 127.0.0.1
//   node src/tools/symuluj-logger32.js --znak SP9XYZ --ile 3
//   node src/tools/symuluj-logger32.js --stacja SN8N --pasmo 20m --emisja FT8
import net from 'node:net';

const arg = (nazwa, domyslna) => {
  const i = process.argv.indexOf(`--${nazwa}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : domyslna;
};

const host = arg('host', '127.0.0.1');
const port = Number(arg('port', '52005'));
const ile = Number(arg('ile', '1'));
const stacja = arg('stacja', 'SQ8BWM');
const pasmo = arg('pasmo', '40m');
const emisja = arg('emisja', 'SSB');
const znakBazowy = arg('znak', '');

/** Tag ADIF z deklarowaną długością — dokładnie tak, jak zapisuje to Logger32. */
const tag = (nazwa, wartosc) => `<${nazwa}:${Buffer.byteLength(String(wartosc))}>${wartosc}`;

function rekord(nr) {
  const teraz = new Date();
  const data = teraz.toISOString().slice(0, 10).replace(/-/g, '');
  const czas = teraz.toISOString().slice(11, 19).replace(/:/g, '');
  // Bez podanego znaku losujemy taki, który na pewno nie jest niczyim prawdziwym
  // QSO — gdyby ktoś odpalił to z włączonym wysyłaniem, nie zaśmieci akcji.
  const znak = znakBazowy || `SQ0TEST${nr}`;
  return [
    tag('call', znak),
    tag('qso_date', data),
    tag('time_on', czas),
    tag('band', pasmo),
    tag('mode', emisja),
    tag('station_callsign', stacja),
    tag('operator', stacja),
    tag('rst_sent', '59'),
    tag('rst_rcvd', '59'),
    tag('comment', 'symulator Logger32'),
    '<eor>',
  ].join('');
}

function wyslij(tresc, nr) {
  return new Promise((gotowe, blad) => {
    const s = net.connect(port, host, () => {
      s.write(tresc);
      s.end();                       // Logger32 zamyka połączenie po każdym QSO
    });
    s.on('close', () => {
      console.log(`  [${nr}] wysłane ${tresc.length} B do ${host}:${port}`);
      gotowe();
    });
    s.on('error', blad);
  });
}

const main = async () => {
  console.log(`Udaję Logger32 → tcp://${host}:${port}`);
  for (let i = 1; i <= ile; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- kolejne QSO, nie wyścig
    await wyslij(rekord(i), i);
  }
  console.log('Gotowe. Zajrzyj do zakładki Log albo do bridge.log.');
};

main().catch((err) => {
  console.error(`Nie udało się: ${err.message}`);
  if (err.code === 'ECONNREFUSED') {
    console.error('Nikt nie słucha na tym porcie. Włącz w Konfiguracji '
      + '„Odbieraj QSO z Logger32 po TCP" i uruchom program ponownie.');
  }
  process.exit(1);
});
