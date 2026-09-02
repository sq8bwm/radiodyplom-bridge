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
