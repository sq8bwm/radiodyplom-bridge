// Przywracanie QSO z data/failed/ do kolejki.
// Jedna implementacja używana przez CLI (npm run requeue) i przez API stanu.
import { unlinkSync } from 'node:fs';
import { log } from './log.js';

/**
 * @param {import('./store.js').Store} store
 * @returns {{restored:number, skipped:number, calls:string[]}}
 */
export function requeueFailed(store) {
  let restored = 0;
  let skipped = 0;
  const calls = [];

  for (const item of store.listFailed()) {
    // Odrzucone trwale przez serwer są już w "seen" – nie ponawiamy ich.
    if (store.seen.has(item.key)) { skipped += 1; continue; }

    const added = store.enqueue({ key: item.key, payload: item.payload, meta: item.meta });
    if (!added) { skipped += 1; continue; }

    try { unlinkSync(item._file); } catch { /* zniknął w międzyczasie */ }
    restored += 1;
    calls.push(item.payload.callsign);
  }

  if (restored) log.info(`Przywrócono do kolejki: ${restored}`, { calls });
  return { restored, skipped, calls };
}
