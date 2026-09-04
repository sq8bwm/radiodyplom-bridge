// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Proces główny Electrona.
//
// Rdzeń jest tu OSADZONY (startDaemon), a nie uruchamiany osobno — dzięki temu
// UI rozmawia z nim bezpośrednio, bez HTTP. Serwer HTTP zostaje włączony tylko
// po to, by dało się też podejrzeć stan z przeglądarki albo skryptu.
import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig, configPath } from '../src/config.js';
import { startDaemon } from '../src/daemon.js';
import { log } from '../src/log.js';
import { closeFileLog } from '../src/logfile.js';
import { t, setLang } from './strings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let daemon = null;
let win = null;
let tray = null;
let quitting = false;

// Jedna instancja – dwie próbowałyby zająć ten sam port UDP i tylko jedna
// dostawałaby datagramy, co byłoby bardzo mylące w diagnostyce.
//
// UWAGA: samo `app.quit()` NIE przerywa wykonywania tego modułu. Bez flagi
// niżej `app.whenReady()` i tak startował cały rdzeń — przejmował blokadę
// katalogu danych, bindował port UDP i kolejkę — a potem proces umierał.
// QSO odebrane w tym okienku wpadłoby do kolejki, której nikt już nie
// obsługuje. Zaobserwowane 2026-09-04 przy dwóch instancjach na różnych
// konfiguracjach (różne porty, więc blokady nie zdążyły zaprotestować).
const mamyBlokadeInstancji = app.requestSingleInstanceLock();
if (!mamyBlokadeInstancji) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

function iconFor(state) {
  const file = state === 'paused' ? 'tray-paused.png'
    : state === 'error' ? 'tray-error.png'
      : 'tray-ok.png';
  return nativeImage.createFromPath(join(__dirname, 'icons', file));
}

/** Stan do ikony i podpowiedzi — kod stanu z rdzenia, teksty z własnego słownika. */
function trayState() {
  if (!daemon) return { state: 'error', tip: t('state.coreDown') };
  const s = daemon.status();
  const dry = s.radiodyplom.dryRun ? ' • DRY-RUN' : '';
  const rst = (s.pendingRestart || []).length ? ` • ${t('restart.tray')}` : '';

  if (s.state === 'error') {
    return {
      state: 'error',
      tip: `${t('state.offline')} • ${t('msg.inQueue')}${s.queue.pending}${t('msg.autoResend')}${dry}${rst}`,
    };
  }
  if (s.state === 'warn') {
    const why = s.queue.paused ? t('state.paused') : `${t('state.rejected')}${s.queue.failed}`;
    return { state: 'paused', tip: `${why} • ${t('msg.inQueue')}${s.queue.pending}${dry}${rst}` };
  }
  return {
    state: 'ok',
    tip: `${s.radiodyplom.profile || '—'} • ${t('msg.sentCount')}${s.queue.sent}`
      + ` • ${t('msg.inQueue')}${s.queue.pending}${dry}${rst}`,
  };
}

let lastTrayKey = '';

function refreshTray() {
  if (!tray) return;
  const { state, tip } = trayState();
  tray.setImage(iconFor(state));
  tray.setToolTip(`${t('app.name')} — ${tip}`);

  // Menu przebudowujemy TYLKO gdy zmieniły się jego etykiety. Ustawianie go
  // co 3 sekundy potrafi na Windows sprawić, że menu przestaje się pokazywać.
  const key = `${daemon?.worker.paused}|${getLangKey()}`;
  if (key !== lastTrayKey) {
    lastTrayKey = key;
    tray.setContextMenu(buildMenu());
  }
}

function getLangKey() {
  return t('tray.quit');
}

function buildMenu() {
  const paused = daemon?.worker.paused;
  return Menu.buildFromTemplate([
    { label: t('tray.show'), click: () => showWindow() },
    { type: 'separator' },
    {
      label: paused ? t('tray.resume') : t('tray.pause'),
      click: () => { paused ? daemon.resume() : daemon.pause(); refreshTray(); },
    },
    {
      label: t('tray.requeue'),
      click: () => { const n = daemon.requeue(); log.info(`Przywrócono z UI: ${n}`); refreshTray(); },
    },
    { type: 'separator' },
    { label: t('tray.openConfig'), click: () => shell.showItemInFolder(configPath()) },
    {
      label: t('tray.openLog'),
      click: () => { const p = daemon?.logFilePath?.(); if (p) shell.showItemInFolder(p); },
    },
    { type: 'separator' },
    { label: t('tray.quit'), click: () => shutdown('menu') },
  ]);
}

function showWindow() {
  if (win) { win.show(); win.focus(); return; }
  win = new BrowserWindow({
    width: 900,
    height: 700,
    title: 'RadioDyplom Bridge',
    icon: iconFor('ok'),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(join(__dirname, 'index.html'));

  // Zamknięcie okna chowa aplikację do zasobnika – daemon ma pracować dalej.
  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; });
}

if (mamyBlokadeInstancji) app.whenReady().then(async () => {
  // Po instalacji katalog programu jest tylko do odczytu — konfiguracja i dane
  // muszą trafić do katalogu użytkownika. W trybie deweloperskim zostaje projekt.
  if (app.isPackaged) process.env.RD_CONFIG_DIR = app.getPath('userData');

  const cfg = loadConfig({ seed: true });
  setLang(cfg.language || 'pl');
  if (cfg._pinMissing) {
    log.warn('Brak PIN-u API — wpisz go w zakładce Konfiguracja. Mostek działa, ale nic nie wyśle.');
  }
  try {
    daemon = await startDaemon(cfg);
  } catch (err) {
    log.error('Rdzeń nie wystartował', err.message);
  }

  // RD_NO_TRAY: uruchomienie bez ikony w zasobniku. Potrzebne do testów
  // automatycznych — ikona rejestruje się przez DBus, więc pojawia się w panelu
  // użytkownika nawet gdy okno idzie na wirtualny ekran.
  if (!process.env.RD_NO_TRAY) {
    tray = new Tray(iconFor('ok'));
    refreshTray();
    tray.on('click', () => showWindow());
    setInterval(refreshTray, 3000);
  } else {
    log.warn('RD_NO_TRAY: pomijam ikonę w zasobniku');
  }

  showWindow();

  // --- most IPC: renderer nie ma dostępu do Node, wszystko idzie tędy ---
  ipcMain.handle('status', () => daemon?.status() ?? null);
  ipcMain.handle('log', (_e, n) => daemon?.log(n) ?? []);
  ipcMain.handle('pause', () => { daemon.pause(); refreshTray(); return true; });
  ipcMain.handle('resume', () => { daemon.resume(); refreshTray(); return true; });
  ipcMain.handle('discardFailed', () => {
    const r = daemon?.discardFailed?.() ?? { removed: 0 };
    refreshTray();
    return r;
  });
  ipcMain.handle('ackProblems', () => { const n = daemon?.ackProblems?.() ?? 0; refreshTray(); return n; });
  ipcMain.handle('requeue', () => { const n = daemon.requeue(); refreshTray(); return n; });
  ipcMain.handle('config:get', () => daemon?.getConfig() ?? null);
  ipcMain.handle('stats', (_e, from, to, filters) => {
    try { return daemon?.stats?.(from, to, filters) ?? null; } catch { return null; }
  });
  // Sprawdzenie uprawnień dla konfiguracji jeszcze NIEZAPISANEJ. Nigdy nie
  // rzuca do okna: brak odpowiedzi serwisu nie może przeszkodzić w zapisie.
  ipcMain.handle('config:check', async (_e, patch) => {
    try {
      return { ok: true, checks: (await daemon?.checkConfig?.(patch)) || [] };
    } catch (err) {
      return { ok: false, error: err.message, checks: [] };
    }
  });
  // Zamknięcie z okna — na Windows menu ikony w zasobniku bywa niedostępne,
  // a samo zamknięcie okna tylko chowa aplikację. Bez tego użytkownik nie
  // miałby żadnego sposobu, żeby ją zakończyć.
  ipcMain.handle('quit', () => { shutdown('przycisk w oknie'); return true; });

  // Pokaż plik logu w menedżerze plików — przy zgłoszeniu usterki to pierwsza
  // rzecz, o którą trzeba poprosić, więc nie może wymagać szukania po dysku.
  // Odnośniki otwieramy w przeglądarce systemowej, nie w oknie aplikacji.
  // Sprawdzenie schematu jest celowe: shell.openExternal wykona też
  // `file:` czy `mailto:`, a stąd mają wychodzić wyłącznie strony.
  ipcMain.handle('openUrl', (_e, url) => {
    const ok = typeof url === 'string' && /^https:\/\//.test(url);
    if (!ok) {
      log.warn('Odrzucam otwarcie odnośnika o nieoczekiwanym schemacie', String(url).slice(0, 80));
      return false;
    }
    shell.openExternal(url);
    return true;
  });

  ipcMain.handle('openLog', () => {
    const p = daemon?.logFilePath?.();
    if (p) shell.showItemInFolder(p);
    return p || null;
  });

  ipcMain.handle('config:save', (_e, patch) => {
    const r = daemon.saveConfig(patch);
    // Zmiana języka musi też przełożyć menu i podpowiedź w zasobniku.
    if (patch.language) setLang(patch.language);
    refreshTray();
    return r;
  });
});

// Sama subskrypcja tego zdarzenia wyłącza domyślne „zamknij okno = zakończ aplikację".
// Aplikacja ma żyć w zasobniku; kończy ją wyłącznie pozycja „Zakończ" w menu.
app.on('window-all-closed', () => { /* celowo nic – patrz komentarz */ });

/**
 * Uporządkowane zamknięcie.
 *
 * Bez tego `kill` zabijał proces natychmiast: `before-quit` się nie wykonywał,
 * ikona w zasobniku nie była wyrejestrowana, a panel XFCE zgłaszał, że wtyczka
 * obszaru powiadomień nieoczekiwanie zniknęła. Ikonę trzeba zniszczyć jawnie.
 */
function shutdown(reason) {
  if (quitting) return;
  quitting = true;
  log.info(`Zamykam (${reason})`);
  try { if (tray) { tray.destroy(); tray = null; } } catch { /* już zniszczona */ }
  try { if (daemon) daemon.stop(); } catch { /* już zatrzymany */ }
  closeFileLog();
  app.quit();
}

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => shutdown(sig));
}

app.on('before-quit', () => {
  quitting = true;
  try { if (tray) { tray.destroy(); tray = null; } } catch { /* już zniszczona */ }
  if (daemon) daemon.stop();
});
