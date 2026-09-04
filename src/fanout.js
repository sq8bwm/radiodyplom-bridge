// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Rozmnażanie jednego QSO z loggera na wiele wpisów — po jednym na znak stacji.
//
// Po co: to samo QSO ma trafić na radiodyplom jako kilka odrębnych łączności,
// każda z własnym STATION_CALL (i opcjonalnie własnym operatorem).
//
// MODEL UPRAWNIEŃ (zmierzony 2026-09-02, patrz docs/konfiguracja.md):
// PIN API należy do KONTA, a konto ma listę znaków stacji, na które wolno mu
// logować. To `station_callsign` decyduje, czy QSO zostanie zapisane.
//
// Pole `operator` serwer sprawdza TYLKO jako znak krótkofalarski (zmierzone
// 2026-09-04, potwierdzone przez autora serwisu): z żadną listą go nie wiąże,
// więc przechodzi dowolny poprawny znak, także nieistniejący — ale wartość
// niebędąca znakiem odbija QSO (`INVALID_CALLSIGN`, HTTP 400), a dłuższa niż
// 15 znaków jest po cichu UCINANA. Wcześniejszy komentarz twierdził, że
// serwer nie sprawdza tego pola w ogóle; to był zbyt mocny wniosek z pomiaru
// na znaku o poprawnym kształcie.
//
// Stąd rola pola `pin` przy celu: potrzebne tylko wtedy, gdy dana stacja NIE
// jest przypisana do Twojego konta, a jest do cudzego. Wtedy kopia musi polecieć
// PIN-em tego konta. Gdy stacja jest na Twojej liście, wystarczy PIN główny.
import { log } from './log.js';

/**
 * @param {object} payload  ładunek po zmapowaniu (mapper.js)
 * @param {Array}  targets  cfg.forward.targets
 * @param {string} baseKey  klucz deduplikacji QSO źródłowego
 * @returns {Array<{key:string, payload:object, station:string}>}
 */
/** Czy reguła jest włączona. Brak pola = włączona (zgodność ze starszymi plikami). */
export function targetEnabled(t) {
  return t?.enabled !== false;
}

export function expandTargets(payload, targets, baseKey) {
  // Liczą się tylko reguły włączone. Wyłączona zostaje w konfiguracji
  // z całą treścią — o to chodzi w znaczniku: dać się wyłączyć bez
  // przepisywania znaków i PIN-ów od nowa.
  const active = (Array.isArray(targets) ? targets : []).filter(targetEnabled);

  // Brak celów — albo wszystkie wyłączone — to zachowanie jak bez fan-outu:
  // jedno QSO ze stacją z loggera. Świadomie NIE „nie wysyłamy nic",
  // bo ciche gubienie QSO to najgorsze, co ten program może zrobić.
  if (active.length === 0) {
    return [{ key: baseKey, payload, station: payload.station_callsign }];
  }

  const out = [];
  const seenStations = new Set();

  for (const t of active) {
    const station = String(t?.station_callsign || '').trim().toUpperCase();
    if (!station) {
      log.warn('Cel fan-outu bez station_callsign – pomijam', t);
      continue;
    }
    if (seenStations.has(station)) {
      log.warn(`Cel fan-outu ${station} powtórzony w konfiguracji – pomijam duplikat`);
      continue;
    }
    seenStations.add(station);

    const p = { ...payload, station_callsign: station };

    // Operator opcjonalny. Gdy cel go nie podaje, zostaje operator z loggera.
    // Celowo NIE podstawiamy tu znaku stacji – to dwa różne pola.
    if (t.operator) p.operator = String(t.operator).trim().toUpperCase();

    // PIN konta, z którego ma polecieć ta kopia. Brak = PIN główny.
    if (t.pin) p.api_key = String(t.pin).trim();

    // Klucz musi być różny dla każdej kopii, inaczej nasza deduplikacja
    // przepuściłaby tylko pierwszą z nich.
    out.push({ key: `${baseKey}|${station}`, payload: p, station });
  }

  return out;
}
