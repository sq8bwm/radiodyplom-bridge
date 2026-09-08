// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Proces główny Electrona.
//
// Rdzeń jest tu OSADZONY (startDaemon), a nie uruchamiany osobno — dzięki temu
// UI rozmawia z nim bezpośrednio, bez HTTP. Serwer HTTP zostaje włączony tylko
// po to, by dało się też podejrzeć stan z przeglądarki albo skryptu.
import {
  app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, nativeTheme, shell, dialog,
} from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig, configPath } from '../src/config.js';
import { buildReport, saveReport } from '../src/report.js';
import { startDaemon } from '../src/daemon.js';
import { log } from '../src/log.js';
import { closeFileLog } from '../src/logfile.js';
import { t, setLang } from './strings.js';
import { katalogDanychObokPliku, rodzajInstalacji } from '../src/instalacja.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let daemon = null;
let win = null;
let tray = null;
let quitting = false;
let bladStartu = null;

// Katalog danych USTALAMY TU, przed blokadą jednej instancji — bo ta blokada
// jest w Electronie zawieszona właśnie na katalogu `userData`. Dopóki portable
// i wersja instalowana miały ten sam katalog, druga z nich nie dawała się
// uruchomić w ogóle; po przestawieniu katalogu dwie instancje na RÓŻNYCH
// portach są możliwe (opis w docs/konfiguracja.md).
const daneObok = katalogDanychObokPliku();
if (daneObok?.katalog && !daneObok.blad) {
  app.setPath('userData', daneObok.katalog);
  // JAWNIE, a nie licząc na gałąź `app.isPackaged` niżej: inaczej ten tryb
  // działał tylko w wersji spakowanej i nie dawał się sprawdzić na źródłach —
  // co od razu wyszło przy pierwszej próbie z dwiema instancjami.
  process.env.RD_CONFIG_DIR = daneObok.katalog;
  // I DANE, nie tylko konfiguracja: `dataDir: "auto"` wskazuje inaczej katalog
  // systemowy (na Linuksie ~/.local/share), więc dwie instancje wchodziłyby
  // sobie w kolejkę i w blokadę katalogu danych — sprawdzone doświadczalnie.
  process.env.RD_DATA_DIR = daneObok.katalog;
}

// Jedna instancja NA JEDEN KATALOG DANYCH – dwie na tym samym katalogu
// próbowałyby zająć ten sam port UDP i tylko jedna dostawałaby datagramy,
// co byłoby bardzo mylące w diagnostyce.
//
// UWAGA: samo `app.quit()` NIE przerywa wykonywania tego modułu. Bez flagi
// niżej `app.whenReady()` i tak startował cały rdzeń — przejmował blokadę
// katalogu danych, bindował port UDP i kolejkę — a potem proces umierał.
// QSO odebrane w tym okienku wpadłoby do kolejki, której nikt już nie
// obsługuje. Zaobserwowane 2026-09-04 przy dwóch instancjach na różnych
// konfiguracjach (różne porty, więc blokady nie zdążyły zaprotestować).
// Plik, który użytkownik NAPRAWDĘ kliknął. `process.execPath` przy AppImage
// i portable wskazuje kopię w katalogu tymczasowym (`/tmp/.mount_…`,
// `%TEMP%\…`), czyli ścieżkę, która człowiekowi nic nie mówi.
const mojPlik = process.env.APPIMAGE || process.env.PORTABLE_EXECUTABLE_FILE
  || process.execPath;

// `additionalData` dojdzie do instancji, która już działa — inaczej znałaby
// tylko `argv[0]` drugiej, czyli znów ścieżkę tymczasową.
const mamyBlokadeInstancji = app.requestSingleInstanceLock({
  plik: mojPlik,
  rodzaj: rodzajInstalacji().rodzaj,
});
if (!mamyBlokadeInstancji) {
  app.quit();
} else {
  app.on('second-instance', (_zdarzenie, argv, _katalog, dodatkowe) => {
    showWindow();
    // Drugie kliknięcie TEJ SAMEJ ikony ma tylko pokazać okno i nic nie mówić.
    // Ale gdy ktoś uruchamia INNY PLIK (AppImage przy działającej paczce .deb,
    // portable przy instalatorze), pokazanie cudzego okna jest mylące: wygląda,
    // jakby nowy plik nie działał. Zgłoszone 2026-09-08 — „uaktywnia mi
    // uruchomioną wersję zainstalowaną zamiast nowej instancji".
    // `dodatkowe` mamy od 0.1.23; starsza druga instancja przyśle tylko argv.
    const skad = dodatkowe?.plik || argv?.[0];
    if (!skad || skad === mojPlik || skad === process.execPath) return;

    const opis = (plik, rodzaj) => (rodzaj ? `${t(`install.${rodzaj}`)} — ${plik}` : plik);
    const ja = opis(mojPlik, rodzajInstalacji().rodzaj);
    const on = opis(skad, dodatkowe?.rodzaj);
    log.warn(`Druga instancja: ${on} — działa już ${ja}; pokazuję okno działającej`);
    dialog.showMessageBox(win ?? undefined, {
      type: 'info',
      title: t('secondInstance.title'),
      message: t('secondInstance.title'),
      detail: `${t('secondInstance.running')}\n${ja}\n\n`
        + `${t('secondInstance.launched')}\n${on}\n\n${t('secondInstance.howTo')}`,
      buttons: [t('secondInstance.ok')],
      noLink: true,
    }).catch(() => { /* brak okna nadrzędnego nie może wywalić programu */ });
  });
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
    // Zgłoszenie PRZED plikiem konfiguracji: łatwiejsza droga ma być
    // bezpieczna. config.json zawiera jawny PIN, a to on jest pierwszą
    // rzeczą, którą człowiek wysyła, gdy coś nie działa.
    { label: t('tray.saveReport'), click: () => zapiszZgloszenie() },
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
  if (daneObok?.blad === 'tylko-do-odczytu') {
    log.warn(`Katalog ${daneObok.katalog} jest tylko do odczytu — dane zostają `
      + `w ${app.getPath('userData')}`);
  } else if (daneObok?.katalog) {
    log.info(`Dane obok pliku programu: ${daneObok.katalog}`);
  }

  const cfg = loadConfig({ seed: true });
  setLang(cfg.language || 'pl');
  nativeTheme.themeSource = ['light', 'dark'].includes(cfg.theme) ? cfg.theme : 'system';
  if (cfg._pinMissing) {
    log.warn('Brak PIN-u API — wpisz go w zakładce Konfiguracja. Mostek działa, ale nic nie wyśle.');
  }
  try {
    daemon = await startDaemon(cfg);
  } catch (err) {
    // Powód MUSI dotrzeć do okna. Bez tego okno pokazywało pusty szkielet
    // z szarą kreską w plakietce i wyglądało na „jeszcze wstaje" — na zawsze
    // (zobaczone 2026-09-08 przy dwóch instancjach na jednym porcie UDP).
    // API stanu wtedy nie działa, bo startuje razem z rdzeniem, więc jedyną
    // drogą jest IPC.
    bladStartu = err.message;
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
  ipcMain.handle('status', () => daemon?.status()
    ?? (bladStartu ? { bladStartu, configFile: configPath() } : null));
  // „Pokaż plik konfiguracji" — przy nieudanym starcie zakładka Konfiguracja
  // jest pusta (dane idą z rdzenia), więc jedyną drogą naprawy jest plik.
  ipcMain.handle('showConfigFile', () => {
    shell.showItemInFolder(configPath());
    return true;
  });
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
  // Motyw: CSS okna ustawia sobie renderer, ale ramka okna, menu kontekstowe
  // i paski przewijania idą za `nativeTheme` — bez tego ciemne okno miałoby
  // jasne obramowanie i jasne menu pod prawym przyciskiem.
  ipcMain.handle('theme:set', (_e, wybor) => {
    nativeTheme.themeSource = ['light', 'dark'].includes(wybor) ? wybor : 'system';
    return nativeTheme.themeSource;
  });
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

  /**
   * Zapisuje zgłoszenie obok logu i pokazuje je w menedżerze plików.
   * @returns {string|null} ścieżka albo null przy błędzie
   */
  function zapiszZgloszenie() {
    try {
      const logPath = daemon?.logFilePath?.();
      const katalog = logPath ? dirname(logPath) : (cfg._dataDir || app.getPath('userData'));
      const st = daemon?.status?.() ?? null;
      // Wersję bierzemy ze statusu (rdzeń czyta package.json), a gdy demon nie
      // wstał — z Electrona. `readPkg` z daemon.js jest prywatne i nie ma go tu.
      const plik = saveReport(katalog, buildReport({
        cfg,
        status: st,
        pkg: { name: 'radiodyplom-bridge', version: st?.version || app.getVersion() },
      }));
      log.info(`Zapisano zgłoszenie: ${plik}`);
      shell.showItemInFolder(plik);
      return plik;
    } catch (err) {
      log.error(`Nie udało się zapisać zgłoszenia: ${err.message}`);
      return null;
    }
  }

  ipcMain.handle('report:save', () => zapiszZgloszenie());
  ipcMain.handle('restart', () => { restartProgramu('przycisk w oknie'); return true; });

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

/**
 * Restart programu na życzenie z okna.
 *
 * Kolejność ma znaczenie: `app.relaunch()` tylko PLANUJE nowy proces —
 * uruchamia go dopiero przy wyjściu bieżącego. Musi więc być wywołane PRZED
 * zamknięciem, inaczej program po prostu się zamknie.
 *
 * Idziemy tą samą ścieżką co „Zakończ" (`shutdown`), żeby restart nie ominął
 * zamknięcia kolejki, zniszczenia ikony w zasobniku i zamknięcia pliku logu.
 */
function restartProgramu(reason) {
  if (quitting) return;
  log.info(`Restart na życzenie (${reason})`);

  // WERSJA PORTABLE (Windows) rozpakowuje się do katalogu tymczasowego, więc
  // `process.execPath` wskazuje tę kopię, a nie plik .exe, który kliknął
  // użytkownik. Restart bez tego wskazania odpalałby rozpakowaną kopię —
  // a jej katalog bywa sprzątany przy wyjściu. Zmienną ustawia instalator
  // portable electron-buildera (`PORTABLE_EXECUTABLE_FILE = $EXEPATH`,
  // sprawdzone w app-builder-lib/templates/nsis/portable.nsi).
  const portable = process.env.PORTABLE_EXECUTABLE_FILE;
  app.relaunch(portable ? { execPath: portable } : undefined);

  // BLOKADA JEDNEJ INSTANCJI: nowy proces startuje w chwili, gdy ten jeszcze
  // może trzymać blokadę. Nowa instancja zobaczyłaby ją zajętą i natychmiast
  // się zamknęła — użytkownik zostałby BEZ programu, co jest gorsze niż brak
  // przycisku. Zwalniamy ją jawnie, zamiast liczyć na kolejność zamykania.
  try { app.releaseSingleInstanceLock(); } catch { /* nie mieliśmy blokady */ }

  shutdown(`restart: ${reason}`);
}

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => shutdown(sig));
}

app.on('before-quit', () => {
  quitting = true;
  try { if (tray) { tray.destroy(); tray = null; } } catch { /* już zniszczona */ }
  if (daemon) daemon.stop();
});
