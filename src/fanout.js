// Rozmnażanie jednego QSO z loggera na wiele wpisów — po jednym na znak stacji.
//
// Po co: to samo QSO ma trafić na radiodyplom jako kilka odrębnych łączności,
// każda z własnym STATION_CALL (i opcjonalnie własnym operatorem).
//
// WAŻNE: to o tym, do której akcji trafi QSO, decyduje `station_callsign`
// (serwer zwraca listę `savedTo`), a nie PIN. Znak stacji musi mieć uprawnienia
// w aktywnej akcji — inaczej serwer odpowie success:true z pustym savedTo
// i QSO przepadnie (obsługiwane w radiodyplom.js jako błąd NOT_SAVED).
import { log } from './log.js';
import { targetOperator } from './operators.js';

/**
 * @param {object} payload  ładunek po zmapowaniu (mapper.js)
 * @param {Array}  targets  cfg.forward.targets
 * @param {string} baseKey  klucz deduplikacji QSO źródłowego
 * @returns {Array<{key:string, payload:object, station:string, pinExplicit:boolean}>}
 */
export function expandTargets(payload, targets, baseKey) {
  // Brak celów → zachowanie jak dotąd: jedno QSO, stacja z loggera.
  if (!Array.isArray(targets) || targets.length === 0) {
    return [{ key: baseKey, payload, station: payload.station_callsign, pinExplicit: false }];
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

    // Operator wskazuje osobę z bazy: trafia do pola OPERATOR i wyznacza PIN.
    // Gdy cel go nie podaje (starsza konfiguracja), zostaje operator z loggera.
    // Celowo NIE podstawiamy tu znaku stacji – to dwa różne pola.
    const op = targetOperator(t);
    if (op) p.operator = op;

    // PIN rozstrzyga się dopiero przy wysyłce, na podstawie operatora i bazy
    // (worker.js). Tutaj tylko starsza droga: PIN wpisany wprost w cel. Musi
    // być oznaczony, bo inaczej nie da się go odróżnić od PIN-u głównego
    // i baza operatorów by go nadpisała.
    let pinExplicit = false;
    if (t.pin) {
      p.api_key = String(t.pin).trim();
      pinExplicit = true;
    }

    // Klucz musi być różny dla każdej kopii, inaczej nasza deduplikacja
    // przepuściłaby tylko pierwszą z nich.
    out.push({ key: `${baseKey}|${station}`, payload: p, station, pinExplicit });
  }

  return out;
}
