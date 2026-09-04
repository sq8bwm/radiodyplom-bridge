// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Sprawdzanie konfiguracji względem uprawnień konta na radiodyplom.pl.
//
// Model uprawnień (zmierzony 2026-09-02, potwierdzony przez autora serwisu):
// PIN należy do KONTA, konto ma listę znaków stacji, w imieniu których wolno
// mu rozdawać punkty. Pole `operator` nie jest z tą listą wiązane — może być
// dowolnym poprawnym znakiem. Wysyłka pod znakiem stacji spoza listy kończy
// się `success: true` z pustym `savedTo`, czyli QSO nigdzie nie trafia.
//
// Dlatego sprawdzamy PARĘ (PIN celu → znak stacji tego celu): stacja musi być
// na liście konta, którego kluczem kopia leci, a nie konta głównego.
//
// Tu jest sama logika, bez sieci — dzięki temu każdy przypadek da się
// sprawdzić testem, w tym te, których nie umiem wywołać na żywym serwisie.

/** Stany, przy których serwis kopii NIE przyjmie — trzeba ostrzec wprost. */
const BLOKUJACE = new Set(['missing-station', 'bad-pin', 'api-disabled', 'no-pin']);

/** Czy dany stan znaczy „ta kopia się nie zapisze". */
export function isBlocking(state) {
  return BLOKUJACE.has(state);
}

/**
 * Różne PIN-y występujące w konfiguracji, po jednym wpisie na PIN.
 *
 * Cele bez własnego PIN-u lecą kluczem głównym, więc nie dodają nic do listy.
 * Cel z PIN-em równym głównemu też nie — inaczej odpytywalibyśmy to samo konto
 * kilka razy i zjadali limit tempa bez powodu.
 */
export function distinctPins(cfg) {
  const main = cfg?.radiodyplom?.pin || null;
  const out = [];
  if (main) out.push({ pin: main, main: true, stations: [] });

  for (const t of cfg?.forward?.targets || []) {
    if (!t?.pin) continue;
    const station = String(t.station_callsign || '').trim().toUpperCase();
    const znany = out.find((o) => o.pin === t.pin);
    if (znany) {
      if (station && !znany.stations.includes(station)) znany.stations.push(station);
      continue;
    }
    out.push({ pin: t.pin, main: false, stations: station ? [station] : [] });
  }

  // Do celów bez własnego PIN-u używany jest klucz główny.
  const glowny = out.find((o) => o.main);
  if (glowny) {
    for (const t of cfg?.forward?.targets || []) {
      if (t?.pin) continue;
      const station = String(t?.station_callsign || '').trim().toUpperCase();
      if (station && !glowny.stations.includes(station)) glowny.stations.push(station);
    }
  }
  return out;
}

/**
 * Ocena każdego celu fan-outu wobec danych kont.
 *
 * @param {object}  arg
 * @param {object[]} arg.targets   cele z konfiguracji
 * @param {string?} arg.mainPin    PIN główny (dla celów bez własnego)
 * @param {Map<string,object>} arg.accounts  PIN → wynik `client.ping()`
 * @returns {{station:string, enabled:boolean, pinSource:'main'|'own',
 *            operator:string|null, state:string, blocking:boolean}[]}
 */
export function verifyTargets({ targets = [], mainPin = null, accounts = new Map() }) {
  return (Array.isArray(targets) ? targets : []).map((t) => {
    const station = String(t?.station_callsign || '').trim().toUpperCase();
    const wlasny = !!t?.pin;
    const pin = wlasny ? t.pin : mainPin;
    const acc = pin ? accounts.get(pin) : null;
    const wynik = {
      station,
      enabled: t?.enabled !== false,
      pinSource: wlasny ? 'own' : 'main',
      operator: acc?.ok ? (acc.operator || null) : null,
      state: 'unknown',
    };

    // Kolejność ma znaczenie: przy złym kluczu lista stacji jest bez znaczenia,
    // a przy wyłączonym API nie zadziała nic, nawet poprawna stacja.
    if (!pin) wynik.state = 'no-pin';
    else if (!acc) wynik.state = 'unknown';
    else if (!acc.ok) {
      // Odróżniamy „klucz odrzucony" od „nie dodzwoniłam się". Pierwsze jest
      // usterką konfiguracji, drugie mija samo i nie wolno go tak pokazywać.
      wynik.state = acc.code === 'INVALID_API_KEY' ? 'bad-pin' : 'unknown';
    } else if (acc.apiEnabled === false) wynik.state = 'api-disabled';
    else if (acc.stations === null) wynik.state = 'unknown';   // starszy serwis: nie wiemy
    else if (!acc.stations.includes(station)) wynik.state = 'missing-station';
    else if (Array.isArray(acc.activeActions) && acc.activeActions.length === 0) {
      // Uprawnienia są, ale w tej chwili nie ma do czego zapisać. Stan
      // przechodni — zależy od kalendarza akcji, nie od konfiguracji — więc
      // NIE blokujący: reguła wpisana dzień przed akcją jest poprawna.
      wynik.state = 'no-active-action';
    } else wynik.state = 'ok';

    wynik.blocking = isBlocking(wynik.state);
    return wynik;
  });
}

/** Cele włączone, których serwis nie przyjmie — materiał na ostrzeżenie. */
export function blockingTargets(checks) {
  return (checks || []).filter((c) => c.enabled && c.blocking);
}
