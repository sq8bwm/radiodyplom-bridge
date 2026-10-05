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

/**
 * Ostrzeżenie, gdy port UDP trzyma JUŻ INNY program.
 *
 * Nasz nasłuch binduje z `reuseAddr` (potrzebne do multicastu WSJT-X), więc taki
 * bind SIĘ UDA mimo cudzego gniazda i nikt by się nie dowiedział. A datagram
 * dostaje wtedy tylko jedno gniazdo — zmierzone 2026-10-05 na obu systemach:
 *
 *   Windows 11 → ten, który zbindował się PIERWSZY
 *   Linux      → ten, który zbindował się PÓŹNIEJ
 *
 * Czyli nie da się nawet powiedzieć „wygrywa ten uruchomiony później". Dlatego
 * komunikat mówi o skutku (część QSO przepada), a nie o kolejności.
 *
 * Nie odmawiamy startu: port mógł zająć program, który nam nie przeszkadza,
 * a odmowa zabrałaby decyzję użytkownikowi. Ostrzeżenie ma być widoczne.
 *
 * @param {{host: string, port: number, system?: string}} gdzie
 */
export function ostrzezenieOCudzymNasluchu({ host, port, system = platform() }) {
  const ktoDostaje = system === 'win32'
    ? 'ten, który zbindował się PIERWSZY'
    : 'ten, który zbindował się PÓŹNIEJ';
  return `Port UDP ${host}:${port} trzyma już inny program — zwykle druga aplikacja `
    + `odbierająca QSO z loggera (np. HamConnect, który domyślnie słucha na 12060). `
    + `Oba nasłuchy wstaną, ale datagram dostaje TYLKO JEDEN: na tym systemie `
    + `${ktoDostaje}. Część QSO przepadnie bez śladu w logu. Zmień udp.port u nas `
    + `albo port odbioru w tamtym programie — loggery wysyłają do kilku celów naraz.`;
}
