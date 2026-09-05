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
// API SŁUCHA WYŁĄCZNIE NA 127.0.0.1 i to się nie zmienia. Zdalny dostęp robi
// się tunelem SSH (patrz docs/malinka.md) — wystawienie tego na sieć oddałoby
// obcym sterowanie wysyłką QSO na Twoim PIN-ie.
if (!window.bridge) {
  const czytaj = async (sciezka) => {
    const r = await fetch(sciezka, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };

  const wyslij = async (sciezka, dane) => {
    const r = await fetch(sciezka, {
      method: 'POST',
      headers: dane ? { 'Content-Type': 'application/json' } : {},
      body: dane ? JSON.stringify(dane) : undefined,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };

  window.bridge = {
    // Po tym renderer poznaje, że nie ma pulpitu pod ręką.
    tryb: 'http',

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
