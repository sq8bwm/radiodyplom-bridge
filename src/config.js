// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Wczytywanie i walidacja konfiguracji.
//
// Kluczowa rzecz dla wersji instalowanej: katalog programu jest wtedy tylko do
// odczytu (Windows: Program Files, Linux: /opt), a UI musi móc zapisać config.
// Dlatego katalog konfiguracji jest ustalany zmienną RD_CONFIG_DIR — Electron
// podstawia tam katalog danych użytkownika, a w trybie deweloperskim zostaje
// katalog projektu, czyli zachowanie dotychczasowe.
import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { log } from './log.js';
import { EVENT_RING } from './worker.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, '..');

const APP = 'radiodyplom-bridge';

/** Katalog, w którym trzymamy config.json (i domyślnie dane). */
export function configDir() {
  return process.env.RD_CONFIG_DIR ? resolve(process.env.RD_CONFIG_DIR) : ROOT;
}

/** Plik konfiguracji, do którego zapisuje UI. */
export function configPath() {
  return join(configDir(), 'config.json');
}

/** Wzorzec dostarczany z programem – służy do zasiania pierwszej konfiguracji. */
function examplePath() {
  return resolve(ROOT, 'config.example.json');
}

/**
 * Katalog danych właściwy dla systemu (dla dataDir: "auto").
 */
export function defaultDataDir() {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), APP);
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', APP);
  }
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), APP);
}

/**
 * Ścieżki względne liczymy od dataDir, a gdy go nie ma – od katalogu
 * konfiguracji. W trybie deweloperskim to katalog projektu, więc nic się
 * nikomu nie przenosi; po instalacji to katalog użytkownika.
 */
function makeResolver(dataDir) {
  let base = configDir();
  if (dataDir === 'auto') base = defaultDataDir();
  else if (dataDir) base = isAbsolute(dataDir) ? dataDir : resolve(configDir(), dataDir);
  return (p) => (isAbsolute(p) ? p : resolve(base, p));
}

/**
 * Zasiewa config.json z wzorca, jeśli go jeszcze nie ma. Potrzebne przy
 * pierwszym uruchomieniu wersji instalowanej – użytkownik nie ma skąd wziąć pliku.
 * @returns {boolean} czy plik został właśnie utworzony
 */
export function ensureConfig() {
  const target = configPath();
  if (existsSync(target)) return false;
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(examplePath())) {
    copyFileSync(examplePath(), target);
    return true;
  }
  return false;
}

/**
 * Czy PIN jest w praktyce nieustawiony. JEDNO miejsce, bo ta ocena jest
 * potrzebna i przy wczytaniu, i po każdym zapisie z interfejsu — rozjechanie
 * się tych dwóch dawało komunikat „brak PIN-u" wiszący mimo wpisania PIN-u.
 */
export function isPinMissing(pin) {
  return !pin || !String(pin).trim() || String(pin).toUpperCase() === 'WSTAW-PIN';
}

/**
 * @param {{seed?:boolean}} opts seed=true zasiewa config.json, gdy go brak
 * @returns cfg; brak PIN-u NIE jest błędem – UI musi wstać, żeby dało się go wpisać
 */
export function loadConfig(opts = {}) {
  if (opts.seed) ensureConfig();

  const primary = configPath();
  const path = existsSync(primary) ? primary : examplePath();

  let cfg;
  try {
    cfg = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Nie mogę wczytać konfiguracji (${path}): ${err.message}`);
  }

  if (process.env.RD_PIN) cfg.radiodyplom.pin = process.env.RD_PIN.trim();

  // Brak PIN-u tylko odnotowujemy. Rzucenie wyjątkiem uniemożliwiłoby
  // pierwsze uruchomienie zainstalowanej aplikacji, gdzie PIN wpisuje się w UI.
  cfg._pinMissing = isPinMissing(cfg.radiodyplom?.pin);

  if (!cfg.udp?.port) throw new Error('Brak config.udp.port.');

  // Cele fan-outu (opcjonalne)
  cfg.forward = cfg.forward || {};
  const targets = cfg.forward.targets;
  if (targets !== undefined && !Array.isArray(targets)) {
    throw new Error('config.forward.targets musi być listą.');
  }
  for (const t of targets || []) {
    if (!t?.station_callsign || !String(t.station_callsign).trim()) {
      throw new Error('Każdy cel w config.forward.targets wymaga station_callsign.');
    }
    // Znacznik włączenia: normalizujemy do boola, brak pola = włączony.
    // Bez normalizacji `"enabled": "false"` z ręcznej edycji byłoby prawdą.
    t.enabled = t.enabled !== false && String(t.enabled).toLowerCase() !== 'false';
  }

  const wylaczone = (targets || []).filter((t) => !t.enabled).length;
  if (wylaczone) {
    log.info(`Cele fan-outu wyłączone: ${wylaczone} z ${targets.length} — nie polecą`);
  }

  // Ile ostatnich zdarzeń pokazuje interfejs. Ograniczone z góry rozmiarem
  // bufora w workerze — obietnica „pokażę 500" bez zapasu w pamięci byłaby
  // pusta, a z góry bez ograniczenia dałaby ogromny ładunek co 2 sekundy.
  cfg.ui = cfg.ui || {};
  const want = Number(cfg.ui.recentEvents);
  cfg.ui.recentEvents = Number.isFinite(want)
    ? Math.max(5, Math.min(EVENT_RING, Math.round(want)))
    : 20;

  // Rozwiń ścieżki kolejki do bezwzględnych
  const resolvePath = makeResolver(cfg.dataDir);
  cfg.queue.dir = resolvePath(cfg.queue.dir);
  cfg.queue.failedDir = resolvePath(cfg.queue.failedDir);
  cfg.queue.seenFile = resolvePath(cfg.queue.seenFile);
  cfg._source = path;

  return cfg;
}
