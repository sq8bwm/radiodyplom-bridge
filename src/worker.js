// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Worker kolejki: bierze elementy gotowe do wysyłki, respektuje rate limit,
// ponawia z wykładniczym backoffem, trwałe błędy odkłada do failed/.
import { log } from './log.js';

/**
 * Ile zdarzeń trzymamy w pamięci. Świadomie więcej, niż pokazuje interfejs:
 * podniesienie liczby wierszy w konfiguracji ma od razu pokazać historię,
 * a nie zaczynać zbieranie od nowa.
 */
export const EVENT_RING = 200;

export class Worker {
  constructor({ store, client, queue, rateLimit, tickMs = 1000 }) {
    this.store = store;
    this.client = client;
    this.maxAttempts = queue.maxAttempts;
    this.baseDelayMs = queue.baseDelayMs;
    this.maxDelayMs = queue.maxDelayMs;
    this.maxPerMinute = rateLimit.maxPerMinute;
    this.minSpacingMs = rateLimit.minSpacingMs;
    this.tickMs = tickMs;

    this.window = [];        // znaczniki czasu ostatnich wysyłek
    this.lastSendAt = 0;
    this.timer = null;
    this.running = false;
    this.busy = false;
    this.paused = false;                       // wstrzymanie wysyłki z UI
    // `dryRun` osobno od `sent`: przejście próbne niczego nie wysłało, więc
    // liczone razem kłamałoby dokładnie tam, gdzie użytkownik szuka pewności.
    this.counters = { sent: 0, dryRun: 0, duplicates: 0, failed: 0, retries: 0 };
    this.lastSent = null;                      // ostatnie udane QSO (dla UI)
    this.lastError = null;                     // ostatni błąd (dla UI)

    // Bufor ostatnich zdarzeń dla listy w UI. Trzymamy z zapasem względem
    // tego, ile UI pokazuje — użytkownik może podnieść liczbę wierszy
    // w konfiguracji i chcemy, żeby zadziałało to od razu, bez czekania
    // na nowe QSO.
    this.events = [];
    this.maxEvents = EVENT_RING;

    // Czy ostatnia próba wysyłki się udała. To najwierniejszy wskaźnik łączności –
    // wynika z realnego POST-a, a nie z osobnego PING-a.
    this.online = true;
  }

  start() {
    this.running = true;
    this.timer = setInterval(() => this._tick(), this.tickMs);
    log.info('Worker kolejki wystartował', {
      maxPerMinute: this.maxPerMinute, maxAttempts: this.maxAttempts,
    });
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Dopisuje zdarzenie do bufora.
   * @param {'sent'|'duplicate'|'retry'|'rejected'|'exhausted'} kind
   */
  _event(kind, item, extra = {}) {
    this.events.push({
      at: new Date().toISOString(),
      kind,
      callsign: item.payload.callsign,
      station: item.payload.station_callsign,
      operator: item.payload.operator || null,
      source: item.meta?.source || null,
      ...extra,
    });
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
  }

  /** Ostatnie zdarzenia, najnowsze na końcu. */
  recentEvents(n = 20) {
    const k = Math.max(1, Math.min(this.maxEvents, Number(n) || 20));
    return this.events.slice(-k);
  }

  /** Czy wolno teraz wysłać (okno 60 s + minimalny odstęp). */
  _canSend(now) {
    this.window = this.window.filter((t) => now - t < 60000);
    if (this.window.length >= this.maxPerMinute) return false;
    if (now - this.lastSendAt < this.minSpacingMs) return false;
    return true;
  }

  _backoff(attempts) {
    const raw = this.baseDelayMs * Math.pow(2, attempts - 1);
    const capped = Math.min(raw, this.maxDelayMs);
    // jitter ±20 %, żeby nie synchronizować ponowień
    return Math.round(capped * (0.8 + Math.random() * 0.4));
  }

  /** Wstrzymuje wysyłkę; odbiór z loggera i kolejkowanie działają dalej. */
  pause() { this.paused = true; log.warn('Wysyłka wstrzymana – QSO czekają w kolejce'); }

  resume() { this.paused = false; log.info('Wysyłka wznowiona'); }

  async _tick() {
    if (!this.running || this.busy || this.paused) return;
    const now = Date.now();
    if (!this._canSend(now)) return;

    const due = this.store.list().filter((i) => (i.nextAt || 0) <= now);
    if (due.length === 0) return;

    this.busy = true;
    try {
      await this._process(due[0]);
    } catch (err) {
      log.error('Nieoczekiwany błąd workera', err.message);
    } finally {
      this.busy = false;
    }
  }

  async _process(item) {
    const call = item.payload.callsign;

    const now = Date.now();
    this.window.push(now);
    this.lastSendAt = now;

    const res = await this.client.upload(item.payload);

    if (res.ok) {
      this.online = true;
      this.store.complete(item, { dryRun: !!res.dryRun });
      if (res.dryRun) this.counters.dryRun += 1;
      else if (res.duplicate) this.counters.duplicates += 1;
      else this.counters.sent += 1;
      this.lastSent = {
        callsign: call,
        station: item.payload.station_callsign,
        savedTo: res.savedTo || null,
        source: item.meta?.source || null,
        at: new Date().toISOString(),
      };
      // Tryb próbny MUSI być odróżniony od wysyłki. Wiersz „wysłane" bez numeru
      // akcji, przy QSO które nigdy nie opuściło komputera, to dokładnie ten
      // rodzaj mylącego komunikatu, który już raz kosztował nas gubione QSO.
      const kind = res.dryRun ? 'dryrun' : (res.duplicate ? 'duplicate' : 'sent');
      this._event(kind, item, { savedTo: res.savedTo || null });
      log.info(
        res.dryRun ? `QSO ${call} przeszło próbnie – NIE wysłane na serwer`
          : (res.duplicate ? `QSO ${call} już było na serwerze (duplikat)` : `QSO ${call} zapisane`),
        { akcje: res.savedTo, source: item.meta?.source },
      );
      return;
    }

    item.attempts += 1;
    item.lastError = res.error;
    item.lastErrorCode = res.code || null;
    // Błąd trwały to problem z danymi, nie z łącznością – nie gasimy wtedy „online".
    if (!res.permanent) this.online = false;
    this.lastError = { callsign: call, error: res.error, code: res.code || null, at: new Date().toISOString() };

    if (res.permanent) {
      // Serwer odrzucił dane – ponawianie nic nie zmieni.
      this.counters.failed += 1;
      this._event('rejected', item, { code: res.code || null, error: res.error });
      this.store.fail(item, true);
      log.error(`QSO ${call} odrzucone trwale – do failed/`, {
        code: res.code, error: res.error,
      });
      return;
    }

    if (item.attempts >= this.maxAttempts) {
      // Awaria sieci/serwera: nie oznaczamy jako obsłużone, żeby dało się przywrócić.
      this.counters.failed += 1;
      this._event('exhausted', item, { code: res.code || null, error: res.error, attempts: item.attempts });
      this.store.fail(item, false);
      log.error(`QSO ${call} – wyczerpano ${this.maxAttempts} prób, do failed/ (przywrócisz: npm run requeue)`, {
        error: res.error,
      });
      return;
    }

    this.counters.retries += 1;
    this._event('retry', item, { code: res.code || null, error: res.error, attempts: item.attempts });
    const delay = this._backoff(item.attempts);
    item.nextAt = Date.now() + delay;
    this.store.update(item);
    log.warn(`QSO ${call} nieudane (próba ${item.attempts}), ponowię za ${Math.round(delay / 1000)}s`, {
      error: res.error,
    });
  }
}
