// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Klient API radiodyplom.pl (qso_upload.php).
import { log } from './log.js';

// Klasyfikacja błędów.
//
// Zasada: gdy serwer odpowiedział poprawnym JSON-em z kodem błędu, to znaczy, że
// ODRZUCIŁ dane — wynik jest deterministyczny i ponawianie nic nie zmieni.
// Dlatego domyślnie taki błąd jest TRWAŁY, a ponawiamy tylko to, co z natury
// bywa chwilowe (sieć, timeout, 5xx, 429, limit tempa).
//
// Świadomie nie używamy listy dozwolonych kodów trwałych: nieznany kod
// (np. INVALID_CALLSIGN) byłby wtedy ponawiany godzinami bez sensu.
const TRANSIENT_CODES = new Set([
  'RATE_LIMIT',
  'RATE_LIMIT_EXCEEDED',
  'TOO_MANY_REQUESTS',
  'SERVER_BUSY',
  'TEMPORARY_ERROR',
]);

// Komunikaty wskazujące na chwilowe ograniczenie tempa.
const TRANSIENT_MESSAGE = /rate.?limit|too many|zbyt wiele|przekroczono limit|spr[oó]buj (pon|za)/i;

export class RadiodyplomClient {
  constructor({ apiUrl, pin, timeoutMs = 10000, dryRun = false }) {
    this.apiUrl = apiUrl;
    this.pin = pin;
    this.timeoutMs = timeoutMs;
    this.dryRun = dryRun;
    if (dryRun) log.warn('TRYB DRY-RUN: nic nie zostanie wysłane na radiodyplom.pl');
  }

  async _fetch(url, options = {}) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Sprawdza klucz i pobiera opis konta.
   *
   * `pin` pozwala odpytać konto INNE niż główne — cele fan-outu mogą mieć
   * własne PIN-y, a uprawnienia do znaku stacji są per konto, nie globalne.
   *
   * Rozróżnienie `null` od `[]` jest tu kluczowe: `stations: null` znaczy
   * „serwis nie podał", a `[]` znaczy „konto nie ma ani jednej stacji".
   * Potraktowanie braku pola jako pustej listy kazałoby ostrzegać przed
   * poprawną konfiguracją na każdym starszym serwerze.
   *
   * @returns {{ok:true, operator?:string, stations:string[]|null,
   *            activeActions:object[]|null, pinExpires:string|null,
   *            apiEnabled:boolean|null}
   *          | {ok:false, error:string, code?:string}}
   */
  async ping(pin = this.pin) {
    const url = `${this.apiUrl}?action=PING&api_key=${encodeURIComponent(pin)}`;
    try {
      const res = await this._fetch(url, { method: 'GET' });
      const data = await res.json();
      if (data.success) {
        return {
          ok: true,
          operator: data.operator,
          stations: Array.isArray(data.stations)
            ? data.stations.map((s) => String(s).trim().toUpperCase())
            : null,
          activeActions: Array.isArray(data.activeActions) ? data.activeActions : null,
          pinExpires: data.pinExpires ?? null,
          apiEnabled: typeof data.apiEnabled === 'boolean' ? data.apiEnabled : null,
        };
      }
      return {
        ok: false,
        code: data.error?.code,
        error: data.error?.message || 'PING nieudany',
      };
    } catch (err) {
      return { ok: false, error: `Błąd połączenia: ${err.message}` };
    }
  }

  /**
   * Wysyła jedno QSO.
   * @returns {{ok:true, duplicate?:boolean, data?:object}
   *          | {ok:false, permanent:boolean, code?:string, error:string}}
   */
  async upload(payload) {
    if (this.dryRun) {
      log.info('[dry-run] POST pominięty', payload);
      return { ok: true, dryRun: true };
    }

    let res;
    try {
      // Cel fan-outu może mieć własny PIN (inna akcja) – wtedy wygrywa on.
      const pin = payload.api_key || this.pin;
      res = await this._fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pin}`,
        },
        body: JSON.stringify({ ...payload, api_key: pin }),
      });
    } catch (err) {
      // Brak sieci / timeout → błąd przejściowy.
      return { ok: false, permanent: false, error: `Sieć: ${err.message}` };
    }

    // 5xx / 429 → przejściowe.
    if (res.status >= 500 || res.status === 429) {
      return { ok: false, permanent: false, error: `HTTP ${res.status}` };
    }

    let data;
    try {
      data = await res.json();
    } catch {
      return { ok: false, permanent: false, error: `Zła odpowiedź (HTTP ${res.status})` };
    }

    if (data.success) {
      // UWAGA: serwer potrafi odpowiedzieć success:true i JEDNOCZEŚNIE niczego nie
      // zapisać — np. gdy znak stacji nie ma uprawnień albo nie ma aktywnej akcji:
      //   {"success":true,"savedTo":[],"message":"QSO odebrane, ale ... brak
      //    aktywnych akcji dyplomowych i uprawnień dla podanego znaku."}
      // Potraktowanie tego jako sukces oznaczałoby CICHĄ UTRATĘ QSO, dlatego
      // o powodzeniu decyduje niepusta lista savedTo, a nie samo success.
      const savedTo = Array.isArray(data.savedTo) ? data.savedTo : null;

      if (savedTo && savedTo.length === 0) {
        return {
          ok: false,
          permanent: true,
          code: 'NOT_SAVED',
          error: data.message || 'Serwer przyjął QSO, ale nie zapisał go do żadnej akcji.',
        };
      }

      return { ok: true, savedTo, errors: data.errors || [] };
    }

    const code = data.error?.code;
    const msg = data.error?.message || 'Nieznany błąd';

    // Duplikat traktujemy jak sukces (idempotencja).
    if (code === 'DUPLICATE_QSO' || /duplik/i.test(msg)) {
      return { ok: true, duplicate: true };
    }

    // Domyślnie trwały; przejściowy tylko dla znanych kodów/komunikatów tempa.
    const transient = TRANSIENT_CODES.has(code) || TRANSIENT_MESSAGE.test(msg);
    return { ok: false, permanent: !transient, code, error: msg };
  }
}
