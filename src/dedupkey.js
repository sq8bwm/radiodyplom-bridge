// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Klucze deduplikacji.
//
// DLACZEGO NIE SAM IDENTYFIKATOR Z LOGGERA:
// QLog podaje `rowid` z bazy SQLite. Taki numer jest **ponownie używany po
// skasowaniu rekordu**, więc nowe QSO potrafi dostać numer wcześniej już
// wysłanego — i zostaje po cichu odrzucone jako duplikat. Zdarzyło się to
// realnie 2026-08-31: dwie łączności zniknęły bez śladu.
//
// DLACZEGO NIE SAMA TREŚĆ:
// Gdyby klucz zależał wyłącznie od treści QSO, ponowne zalogowanie tej samej
// łączności w loggerze (typowa reakcja operatora, gdy coś nie doszło) też
// zostałoby odrzucone — czyli droga ratunkowa przestałaby działać.
//
// DLATEGO: identyfikator loggera **razem z** odciskiem treści. Ten sam rekord
// wysłany dwa razy daje ten sam klucz (dedup działa), a nowy rekord z odzyskanym
// numerem daje inny (nic nie ginie).
import { createHash } from 'node:crypto';

/**
 * Odcisk treści QSO — pola, które łącznie identyfikują łączność.
 * Celowo bez raportów i komentarza: te bywają poprawiane po fakcie,
 * a nie zmieniają tego, że to wciąż ta sama łączność.
 */
export function contentHash(adif) {
  const basis = [
    adif.call, adif.qso_date, adif.time_on,
    adif.band, adif.mode, adif.station_callsign,
  ].map((v) => String(v ?? '').toUpperCase()).join('|');
  return createHash('sha1').update(basis).digest('hex').slice(0, 12);
}

/**
 * Klucz QSO: prefiks źródła, identyfikator z loggera (jeśli jest) i odcisk treści.
 * @param {string} source  np. 'qlog'
 * @param {string|null} nativeId  identyfikator z loggera albo null
 * @param {object} adif  znormalizowany rekord
 */
export function qsoKey(source, nativeId, adif) {
  const id = nativeId ? String(nativeId) : 'noid';
  return `${source}:${id}:${contentHash(adif)}`;
}
