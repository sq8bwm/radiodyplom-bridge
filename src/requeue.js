// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Przywracanie QSO z data/failed/ do kolejki.
// Jedna implementacja używana przez CLI (npm run requeue) i przez API stanu.
//
// DLACZEGO PRZYWRACAMY WSZYSTKO:
// Pierwsza wersja pomijała QSO odrzucone przez serwer „na zawsze", bo są
// w zbiorze deduplikacji. Brzmiało to rozsądnie, ale w praktyce znaczyło, że
// przycisk „Ponów odrzucone" nie robił NIC i nic o tym nie mówił — a to
// najczęstszy przypadek: NOT_SAVED z powodu znaku stacji poza listą konta
// przestaje być prawdą, gdy tylko poprawisz uprawnienia w Managerze.
// Kliknięcie przycisku jest jawnym poleceniem użytkownika, więc uwalniamy
// klucze i próbujemy ponownie. Najgorsze, co się stanie przy QSO naprawdę
// błędnym, to jedno zmarnowane żądanie i powrót do failed/.
import { unlinkSync } from 'node:fs';
import { log } from './log.js';

/**
 * @param {import('./store.js').Store} store
 * @returns {{restored:number, skipped:number, calls:string[]}}
 */
export function requeueFailed(store) {
  const items = store.listFailed();
  if (items.length === 0) return { restored: 0, skipped: 0, calls: [] };

  // Najpierw uwolnij klucze — inaczej enqueue odrzuci je jako duplikaty.
  const freed = store.forgetKeys(items.map((i) => i.key));

  let restored = 0;
  let skipped = 0;
  const calls = [];

  for (const item of items) {
    const added = store.enqueue({ key: item.key, payload: item.payload, meta: item.meta });
    if (!added) { skipped += 1; continue; }        // już czeka w kolejce
    try { unlinkSync(item._file); } catch { /* zniknął w międzyczasie */ }
    restored += 1;
    calls.push(item.payload.callsign);
  }

  if (restored) {
    log.info(`Przywrócono do kolejki: ${restored}`, { calls, uwolnioneKlucze: freed });
  } else {
    log.info('Nie było czego przywracać z odrzuconych', { skipped });
  }
  return { restored, skipped, calls };
}
