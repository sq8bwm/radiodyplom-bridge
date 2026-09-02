// Rozmnażanie jednego QSO z loggera na wiele wpisów — po jednym na znak stacji.
//
// Po co: to samo QSO ma trafić na radiodyplom jako kilka odrębnych łączności,
// każda z własnym STATION_CALL (i opcjonalnie własnym operatorem).
//
// MODEL UPRAWNIEŃ (zmierzony 2026-09-02, patrz docs/konfiguracja.md):
// PIN API to konto, a konto ma listę znaków stacji, na które wolno mu logować.
// To `station_callsign` decyduje, czy QSO zostanie zapisane — pole `operator`
// nie jest przez serwer sprawdzane w ogóle. Dlatego JEDEN PIN obsługuje
// wszystkie stacje, które masz na tej liście, i nie ma tu żadnego dobierania
// PIN-ów per cel.
import { log } from './log.js';

/**
 * @param {object} payload  ładunek po zmapowaniu (mapper.js)
 * @param {Array}  targets  cfg.forward.targets
 * @param {string} baseKey  klucz deduplikacji QSO źródłowego
 * @returns {Array<{key:string, payload:object, station:string}>}
 */
export function expandTargets(payload, targets, baseKey) {
  // Brak celów → zachowanie jak dotąd: jedno QSO, stacja z loggera.
  if (!Array.isArray(targets) || targets.length === 0) {
    return [{ key: baseKey, payload, station: payload.station_callsign }];
  }

  const out = [];
  const seenStations = new Set();

  for (const t of targets) {
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

    // PIN wpisany wprost w cel: droga z 0.1.x, wciąż obsługiwana, choć przy
    // jednym koncie z listą stacji nie jest już potrzebna. Nie ma jej w UI.
    if (t.pin) p.api_key = String(t.pin).trim();

    // Klucz musi być różny dla każdej kopii, inaczej nasza deduplikacja
    // przepuściłaby tylko pierwszą z nich.
    out.push({ key: `${baseKey}|${station}`, payload: p, station });
  }

  return out;
}
