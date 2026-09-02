// Baza operatorów: znak + PIN API, do wyboru przy deklarowaniu rozmnażania QSO.
//
// Po co osobna lista, a nie PIN wpisywany wprost w celu fan-outu:
// PIN jest sekretem i przy kilku stacjach powtarzał się w kilku miejscach
// konfiguracji. Zmiana PIN-u znaczyła wtedy poprawianie każdego celu z osobna,
// a przeoczenie jednego kończyło się cichym NOT_SAVED. Tu PIN jest w jednym
// miejscu, a cel wskazuje operatora po znaku.
//
// Zgodność: `pin` wpisany wprost w celu nadal działa i ma pierwszeństwo —
// nie unieważniamy niczyjej istniejącej konfiguracji.
import { log } from './log.js';

/**
 * Porządkuje listę z konfiguracji: znak wielkimi literami, obcięte spacje.
 * Wpisy bez znaku odpadają — bez znaku nie da się ich wskazać z celu.
 */
export function normalizeOperators(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const o of list) {
    const call = String(o?.call || '').trim().toUpperCase();
    if (!call) {
      log.warn('Wpis w bazie operatorów bez znaku – pomijam', o);
      continue;
    }
    if (seen.has(call)) {
      log.warn(`Operator ${call} powtórzony w bazie – zostawiam pierwszy wpis`);
      continue;
    }
    seen.add(call);
    const entry = { call };
    if (o.name && String(o.name).trim()) entry.name = String(o.name).trim();
    if (o.pin && String(o.pin).trim()) entry.pin = String(o.pin).trim();
    out.push(entry);
  }
  return out;
}

/** Szukanie po znaku, niewrażliwe na wielkość liter. */
export function findOperator(operators, call) {
  const want = String(call || '').trim().toUpperCase();
  if (!want) return null;
  return (operators || []).find((o) => o.call === want) || null;
}

/**
 * Operator wskazany w celu fan-outu. Jedno pole załatwia dwie rzeczy: trafia
 * do pola OPERATOR w wysyłanym QSO i wskazuje, czyim PIN-em kopia leci.
 *
 * `pinFrom` obsługiwane jako starsza nazwa tego samego wskazania.
 */
export function targetOperator(target) {
  const call = String(target?.operator || target?.pinFrom || '').trim().toUpperCase();
  return call || null;
}

/**
 * PIN, którym ma polecieć dana kopia QSO.
 *
 * Kolejność jest istotna i świadoma:
 *  1. `pin` wpisany wprost w celu — starsze konfiguracje muszą działać dalej,
 *  2. PIN operatora z bazy,
 *  3. null — czyli PIN główny z profilu.
 *
 * @returns {{pin:string|null, from:string|null, missing:string|null}}
 *   `missing` niesie znak, którego nie było w bazie — wołający ma to zgłosić.
 */
export function resolveTargetPin(target, operators) {
  if (target?.pin) return { pin: String(target.pin).trim(), from: null, missing: null };

  const ref = targetOperator(target);
  if (!ref) return { pin: null, from: null, missing: null };

  const op = findOperator(operators, ref);
  if (!op) return { pin: null, from: ref, missing: ref };
  if (!op.pin) return { pin: null, from: ref, missing: ref };
  return { pin: op.pin, from: op.call, missing: null };
}

/** Kod odrzucenia: operatora QSO nie ma w bazie, więc nie znamy jego PIN-u. */
export const NO_OPERATOR_PIN = 'NO_OPERATOR_PIN';

/**
 * PIN dla konkretnego QSO, na podstawie jego operatora.
 *
 * PIN należy do OPERATORA, nie do stacji — to on autoryzuje wysyłkę na swoim
 * profilu. Dlatego dopasowujemy po polu OPERATOR, także dla QSO idących bez
 * rozgałęziania (wtedy operator pochodzi wprost z loggera).
 *
 * Rozstrzygnięcia świadome:
 *  - brak operatora w QSO → PIN główny; logger go nie podał, nie ma czego szukać,
 *  - operator to właściciel PIN-u głównego → PIN główny, żeby nie trzeba było
 *    dopisywać samego siebie do bazy,
 *  - profil nieznany (PING jeszcze się nie udał) → PIN główny; z niewiedzy nie
 *    wolno odrzucać, a nieudana wysyłka i tak wróci z błędem,
 *  - operator spoza bazy → `problem`, czyli odrzucenie LOKALNE. Serwer i tak
 *    nie zapisze takiego QSO, a lokalny błąd mówi wprost, co poprawić.
 *
 * @param {string|null} operator  pole OPERATOR z QSO
 * @param {Array} operators  baza
 * @param {string|null} profileCall  znak właściciela PIN-u głównego (z PING-a)
 * @returns {{pin:string|null, problem:string|null, operator:string|null}}
 */
export function resolveOperatorPin(operator, operators, profileCall) {
  const op = String(operator || '').trim().toUpperCase();
  if (!op) return { pin: null, problem: null, operator: null };

  const entry = findOperator(operators, op);
  if (entry?.pin) return { pin: entry.pin, problem: null, operator: op };

  const profile = String(profileCall || '').trim().toUpperCase();
  if (!profile || op === profile) return { pin: null, problem: null, operator: op };

  return { pin: null, problem: NO_OPERATOR_PIN, operator: op };
}
