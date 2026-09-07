// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Ten sam interfejs, ale w przeglądarce.
//
// W Electronie `window.bridge` tworzy `preload.cjs` i ten plik nic nie robi.
// Gdy strona jest serwowana po HTTP (malinka, komputer bez środowiska
// graficznego), most trzeba zbudować z żądań do lokalnego API — i o to tu chodzi.
//
// Dlaczego to jest tanie: renderer potrzebuje czternastu metod, a jedenaście
// z nich miało trasę HTTP na długo przed tym plikiem. API stanu powstało jako
// źródło dla okna i po prostu nadal nim jest.
//
// API domyślnie słucha na 127.0.0.1; nasłuch w sieci wymaga hasła i TLS-a
// (patrz src/apiauth.js i docs/interfejs-w-sieci.md). Zdalny dostęp bez
// otwierania portu robi się tunelem SSH — patrz docs/malinka.md.
if (!window.bridge) {
  // Token CSRF sesji. Trzymany w pamięci strony, NIE w ciasteczku ani
  // localStorage: to jest właśnie ta druga warstwa, której obca strona nie ma
  // jak zdobyć, nawet gdyby jej żądanie doniosło nasze ciasteczko sesji.
  let csrf = null;

  /** Brak sesji = przeładowanie; serwer odda wtedy formularz logowania. */
  const naLogowanie = () => { location.replace('/login.html'); };

  const czytaj = async (sciezka) => {
    const r = await fetch(sciezka, { headers: { Accept: 'application/json' } });
    if (r.status === 401) { naLogowanie(); throw new Error('Wymagane logowanie'); }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };

  const wyslij = async (sciezka, dane) => {
    const naglowki = {};
    if (dane) naglowki['Content-Type'] = 'application/json';
    if (csrf) naglowki['X-CSRF-Token'] = csrf;
    const r = await fetch(sciezka, {
      method: 'POST',
      headers: naglowki,
      body: dane ? JSON.stringify(dane) : undefined,
    });
    if (r.status === 401) { naLogowanie(); throw new Error('Wymagane logowanie'); }
    if (r.status === 403) {
      // Dwa różne powody, dwa różne komunikaty — „nie masz prawa" i „nikt tu
      // nie ma prawa" to dla użytkownika zupełnie inne sytuacje.
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || 'Odmowa (403)');
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };

  /** Pobiera stan sesji i token CSRF. Wołane raz, przed pierwszym żądaniem. */
  const przygotujSesje = async () => {
    try {
      const s = await (await fetch('/api/session')).json();
      if (s.wymagaLogowania && !s.zalogowany) { naLogowanie(); return null; }
      csrf = s.csrf || null;
      return s;
    } catch {
      return null;
    }
  };

  window.bridge = {
    // Po tym renderer poznaje, że nie ma pulpitu pod ręką.
    tryb: 'http',

    // Renderer woła to na starcie, przed pierwszym żądaniem: bez tokenu CSRF
    // każdy zapis wróciłby z 403.
    przygotujSesje,
    logout: () => wyslij('/api/logout'),

    status: () => czytaj('/api/status'),
    // Uchwyt IPC oddaje samą tablicę wpisów, więc tu też — inaczej okno logu
    // dostałoby obiekt i pokazało pustkę.
    log: async (n) => (await czytaj(`/api/log?n=${encodeURIComponent(n)}`)).entries ?? [],

    pause: () => wyslij('/api/pause'),
    resume: () => wyslij('/api/resume'),
    // IPC oddaje LICZBĘ przywróconych, nie obiekt.
    requeue: async () => (await wyslij('/api/requeue')).restored ?? 0,
    ackProblems: async () => (await wyslij('/api/problems/ack')).cleared ?? 0,
    discardFailed: () => wyslij('/api/failed/discard'),

    getConfig: () => czytaj('/api/config'),
    saveConfig: (patch) => wyslij('/api/config', patch),
    // W przeglądarce nie ma czego ustawiać natywnie — motyw robi sam CSS.
    // Metoda istnieje, żeby renderer nie musiał sprawdzać, gdzie działa.
    setTheme: async () => null,
    checkConfig: (patch) => wyslij('/api/config/check', patch),

    stats: (from, to, filtry) => {
      const p = new URLSearchParams();
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      if (filtry?.operator) p.set('operator', filtry.operator);
      if (filtry?.station) p.set('station', filtry.station);
      const q = p.toString();
      return czytaj(`/api/stats${q ? `?${q}` : ''}`);
    },

    openUrl: (url) => window.open(url, '_blank', 'noopener'),

    // ŚWIADOMIE NIE MA `quit` ani `openLog`:
    //  - zamykanie usługi z karty przeglądarki to pułapka; na malince służy do
    //    tego `systemctl stop`, a przypadkowe kliknięcie przerwałoby przekazywanie
    //    QSO w środku pracy w eterze;
    //  - przeglądarka nie otworzy menedżera plików, a log widać w zakładce Log.
    // Renderer ukrywa oba przyciski, gdy ich tu nie znajdzie.
  };
}
