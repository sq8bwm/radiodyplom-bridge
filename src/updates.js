// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Sprawdzanie, czy jest nowsze wydanie.
//
// ŚWIADOMIE tylko POWIADOMIENIE, bez samoaktualizacji. Trzy powody:
//
//  1. Mostek chodzi godzinami podczas pracy w eterze. Aktualizator, który sam
//     się restartuje, przerywa nasłuch UDP — a QSO wysłane przez logger w tym
//     oknie NIE MA JAK wrócić, bo UDP nie ponawia. Program gubiący łączności,
//     żeby się zaktualizować, jest gorszy od nieaktualnego.
//  2. Samoaktualizacja obejmuje tylko dwie z czterech postaci: `latest.yml`
//     opisuje wyłącznie instalator NSIS, a `latest-linux.yml` wyłącznie
//     AppImage. `.deb` i wersja przenośna i tak zostają z powiadomieniem.
//  3. Instalatorów nie podpisujemy, więc pobrana aktualizacja i tak trafiłaby
//     na ostrzeżenie SmartScreen.
//
// Wychodzi na zewnątrz, więc daje się wyłączyć (`updates.check: false`).
import { log } from './log.js';

/**
 * Porównuje wersje SKŁADOWYMI, nie tekstem.
 *
 * Porównanie tekstowe jest tu pułapką, w którą wpadła już nasza własna
 * numeracja: `'0.1.9' < '0.1.10'` daje **false**, więc po wydaniu 0.1.10
 * program uznałby, że 0.1.9 jest nowsze.
 *
 * @returns {number} ujemne gdy a starsze, 0 gdy równe, dodatnie gdy a nowsze
 */
export function compareVersions(a, b) {
  const skladowe = (v) => String(v ?? '').trim().replace(/^v/i, '')
    .split('.').map((x) => Number.parseInt(x, 10));
  const A = skladowe(a);
  const B = skladowe(b);
  for (let i = 0; i < Math.max(A.length, B.length, 3); i += 1) {
    const x = Number.isFinite(A[i]) ? A[i] : 0;
    const y = Number.isFinite(B[i]) ? B[i] : 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/** Czy `latest` jest nowsze od `current`. Śmieci na wejściu → false. */
export function isNewer(latest, current) {
  if (!/^v?\d+(\.\d+)*$/i.test(String(latest ?? '').trim())) return false;
  if (!/^v?\d+(\.\d+)*$/i.test(String(current ?? '').trim())) return false;
  return compareVersions(latest, current) > 0;
}

/** `https://github.com/sq8bwm/radiodyplom-bridge` → `sq8bwm/radiodyplom-bridge`. */
export function repoFromUrl(url) {
  const m = /github\.com[/:]([^/]+\/[^/.]+)/i.exec(String(url ?? ''));
  return m ? m[1] : null;
}

/**
 * Pyta GitHuba o najnowsze wydanie.
 *
 * NIGDY nie rzuca i nie zgłasza braku łączności jako problemu: sprawdzanie
 * aktualizacji jest wygodą, a czerwony stan z tego powodu byłby powtórzeniem
 * błędu, który mieliśmy przy PING-u (ETIMEDOUT kłamał w logu przy sprawnym
 * serwisie).
 *
 * @returns {{ok:true, latest:string, url:string, newer:boolean, checkedAt:string}
 *          | {ok:false, error:string, checkedAt:string}}
 */
export async function checkLatest({
  repo, current, timeoutMs = 10000, fetchImpl = fetch,
} = {}) {
  const checkedAt = new Date().toISOString();
  if (!repo) return { ok: false, error: 'Nie znam repozytorium', checkedAt };

  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, checkedAt };

    const data = await res.json();
    const tag = String(data?.tag_name ?? '').trim();
    if (!tag) return { ok: false, error: 'Wydanie bez numeru', checkedAt };

    return {
      ok: true,
      latest: tag.replace(/^v/i, ''),
      url: data.html_url || `https://github.com/${repo}/releases/latest`,
      newer: isNewer(tag, current),
      checkedAt,
    };
  } catch (err) {
    return { ok: false, error: err?.message || 'Błąd połączenia', checkedAt };
  }
}

/** Sprawdzenie z zapisem do logu. Jedna linia i tylko wtedy, gdy jest nowsze. */
export async function checkAndLog(opts) {
  const r = await checkLatest(opts);
  if (r.ok && r.newer) {
    log.info(`Jest nowsza wersja: ${r.latest} (masz ${opts.current}). ${r.url}`);
  } else if (!r.ok) {
    log.debug(`Nie sprawdziłam aktualizacji: ${r.error}`);
  }
  return r;
}
