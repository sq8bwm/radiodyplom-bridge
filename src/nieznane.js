// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Pamięć na datagramy, których nie umiemy odczytać.
//
// PO CO: dodanie obsługi nowego loggera to jeden plik w `src/decoders/`, ale
// NIE DA SIĘ go napisać z opisu formatu — sprawdzone dwa razy. Logger32 miał
// obsługę „z dokumentacji" i odpadało każde QSO (brak STATION_CALLSIGN), przy
// BBLoggerze nasza własna lista od sierpnia twierdziła coś, czego nikt nie
// zmierzył. Potrzebny jest PRAWDZIWY datagram.
//
// Dotąd prosiliśmy o przechwycenie go przez `nc -u -l 12060`, czego na Windowsie
// nie ma — czyli kazaliśmy ludziom instalować narzędzia, zamiast użyć programu,
// który właśnie mają uruchomiony. Teraz mostek zapisuje je sam, a trafiają do
// pliku zgłoszenia, więc instrukcja brzmi „kliknij Zapisz zgłoszenie", bez ani
// jednego zdania o ścieżkach.
//
// TRZY OGRANICZENIA, każde z powodu:
//   • tylko formaty NIEROZPOZNANE — tego, co umiemy odczytać, nie zapisujemy;
//   • PIERWSZY datagram każdego rodzaju, nie każdy: logger wysyłający dziesięć
//     QSO w jednym formacie zajmuje jedno miejsce, nie dziesięć;
//   • najwyżej 5 rodzajów po 8 kB; po zapełnieniu jedna linia w logu i koniec.
//     Nie kasujemy starych: pierwszy datagram jest najbliżej tego, co człowiek
//     właśnie zrobił, więc jest cenniejszy od dziesiątego.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './log.js';

export const KATALOG = 'nieznane';
export const ILE_RODZAJOW = 5;
export const LIMIT_BAJTOW = 8 * 1024;

/** Odcisk rodzaju datagramu: początek treści wystarcza, żeby odróżnić formaty. */
export function odcisk(buf) {
  return createHash('sha256').update(buf.subarray(0, 64)).digest('hex').slice(0, 12);
}

/**
 * Zapisuje nieznany datagram, jeśli jeszcze nie mamy takiego rodzaju.
 *
 * @returns {{plik:string, odcisk:string}|null} null = pominięte (duplikat albo limit)
 */
export function zapiszNieznany(buf, skad, { dataDir }) {
  if (!dataDir) return null;
  const katalog = join(dataDir, KATALOG);
  try {
    mkdirSync(katalog, { recursive: true });
    const sig = odcisk(buf);
    const istniejace = readdirSync(katalog).filter((f) => f.endsWith('.bin'));

    // Ten sam rodzaj już mamy — cisza, bo inaczej log zalałby się przy każdym QSO.
    if (istniejace.some((f) => f.includes(sig))) return null;

    if (istniejace.length >= ILE_RODZAJOW) {
      // Jedna linia, nie przy każdym datagramie: ostrzegamy tylko przy pierwszym
      // odrzuconym rodzaju po zapełnieniu.
      log.warn(`Mam już ${ILE_RODZAJOW} rodzajów nieznanych datagramów — `
        + 'kolejnych nie zapisuję. Przyślij zgłoszenie (zakładka O programie), '
        + 'a po dopisaniu dekodera katalog wyczyścimy.');
      return null;
    }

    const stempel = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const plik = join(katalog, `${stempel}-${sig}.bin`);
    writeFileSync(plik, buf.subarray(0, LIMIT_BAJTOW), { mode: 0o600 });
    log.info(`Nieznany datagram z ${skad} zapisany do analizy (${buf.length} B). `
      + 'Zakładka O programie → „Zapisz zgłoszenie do wysłania” dołączy go do pliku.');
    return { plik, odcisk: sig };
  } catch (err) {
    // Brak miejsca albo praw do zapisu nie może przerwać przyjmowania QSO.
    log.debug(`Nie zapisałem nieznanego datagramu: ${err.message}`);
    return null;
  }
}

/**
 * Nieznane datagramy do pliku zgłoszenia: hex plus czytelny podgląd.
 *
 * Przycięte do 2 kB na sztukę — tyle wystarcza, żeby rozpoznać format i napisać
 * dekoder, a zgłoszenie zostaje plikiem, który da się wysłać mailem.
 */
export function doZgloszenia(dataDir, { limit = 2048 } = {}) {
  if (!dataDir) return [];
  const katalog = join(dataDir, KATALOG);
  let pliki;
  try {
    pliki = readdirSync(katalog).filter((f) => f.endsWith('.bin')).sort();
  } catch { return []; }

  return pliki.slice(0, ILE_RODZAJOW).map((nazwa) => {
    const sciezka = join(katalog, nazwa);
    const buf = readFileSync(sciezka);
    const kawalek = buf.subarray(0, limit);
    return {
      plik: nazwa,
      bajtow: statSync(sciezka).size,
      hex: kawalek.toString('hex'),
      // Podgląd tekstowy: większość formatów to XML/JSON/ADIF, więc człowiek
      // rozpozna je na pierwszy rzut oka, bez odkodowywania hexa.
      podglad: kawalek.toString('utf8').replace(/[\u0000-\u001f\u007f]/g, '·'),
    };
  });
}
