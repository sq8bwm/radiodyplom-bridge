// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Po ludzku o tym, czemu nie udało się otworzyć portu.
//
// PO CO: komunikat systemowy („listen EACCES: permission denied 0.0.0.0:52005")
// mówi, CO się stało, ale nie mówi, co z tym zrobić — a trafia prosto na czerwony
// baner „Mostek nie wystartował". Użytkownik widzi wtedy tylko tyle, że program
// nie działa, i tak to właśnie zgłasza (2026-10-04: „odhaczyłem UDP i komunikat
// rdzeń nie działa"). Każda minuta zgadywania po jego stronie to minuta, której
// nie musiałby stracić.
import { platform } from 'node:os';

/**
 * @param {Error & {code?: string}} err  błąd z `listen`/`bind`
 * @param {{protokol: 'TCP'|'UDP', host: string, port: number, logger?: string,
 *   system?: string}} gdzie  `system` tylko dla testów — domyślnie ten, na którym
 *   program działa; rada przy EACCES jest inna na Windowsie niż na Linuksie
 * @returns {string} zdanie dla człowieka, zakończone radą
 */
export function opisBleduPortu(err, { protokol, host, port, logger, system = platform() }) {
  const gdzie = `${protokol} ${host}:${port}`;
  // „zmień port” znaczy co innego dla UDP (ustawienie w loggerze) niż dla TCP
  // (ustawienie w Logger32) — stąd parametr, zamiast ogólnikowego „w konfiguracji”.
  const iTam = logger ? ` (i to samo ustawienie w ${logger})` : '';

  switch (err?.code) {
    case 'EADDRINUSE':
      return `Port ${gdzie} jest już zajęty. Zamknij program, który go trzyma, `
        + `albo zmień port w zakładce Konfiguracja${iTam}.`;

    case 'EACCES':
      // Na Windowsie to najczęściej NIE brak praw administratora, tylko zakres
      // portów zarezerwowany przez system (Hyper-V, WSL, Docker Desktop).
      // Uruchamianie mostka „jako administrator” wtedy nie pomaga, a bywa
      // pierwszym, co ludzie próbują — stąd podpowiedź wprost.
      return `Brak dostępu do portu ${gdzie}. ${system === 'win32'
        ? 'Na Windowsie taki port bywa zarezerwowany przez system (Hyper-V, WSL, '
          + 'Docker) — sprawdź poleceniem: netsh int ipv4 show excludedportrange protocol=tcp. '
          + 'Uruchamianie jako administrator zwykle tego NIE omija; pewniejsze jest '
          + `wybranie innego portu${iTam}.`
        : `Porty poniżej 1024 wymagają uprawnień roota — wybierz wyższy${iTam}.`}`;

    case 'EADDRNOTAVAIL':
      return `Adres ${host} nie należy do tej maszyny, więc nie da się na nim nasłuchiwać. `
        + 'Ustaw 127.0.0.1 (tylko ten komputer) albo 0.0.0.0 (wszystkie adresy).';

    default:
      return `Nie udało się otworzyć portu ${gdzie}: ${err?.message || err}`;
  }
}
