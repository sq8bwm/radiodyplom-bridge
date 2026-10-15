// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Proces główny Electrona.
//
// Rdzeń jest tu OSADZONY (startDaemon), a nie uruchamiany osobno — dzięki temu
// UI rozmawia z nim bezpośrednio, bez HTTP. Serwer HTTP zostaje włączony tylko
// po to, by dało się też podejrzeć stan z przeglądarki albo skryptu.
import {
  app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, nativeTheme, shell, dialog, screen,
} from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  loadConfig, configPath, examplePath, ensureConfig,
} from '../src/config.js';
import { buildReport, saveReport } from '../src/report.js';
import { startDaemon } from '../src/daemon.js';
import { log } from '../src/log.js';
import { closeFileLog } from '../src/logfile.js';
import { t, setLang } from './strings.js';
import {
  katalogDanychObokPliku, rodzajInstalacji, zalozKatalogDanych, KATALOG_PRZENOSNY,
  dostosujPortyPrzyZasiewie,
} from '../src/instalacja.js';
import { spawn } from 'node:child_process';

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
    log.warn(`Druga instancja: ${on} — działa już ${ja}; pytam użytkownika`);
    zapytajODrugaInstancje({ skad, ja, on })
      .catch((err) => log.error('Druga instancja: nie udało się zapytać', err.message));
  });
}

/**
 * Pytanie przy próbie uruchomienia DRUGIEJ instancji z innego pliku.
 *
 * Zamiast samego komunikatu jest wybór, bo obie odpowiedzi są sensowne:
 * zwykle chce się pracować dalej na tym, co działa, ale czasem właśnie po to
 * kliknięto drugi plik, żeby mieć osobną instancję (np. akcja dyplomowa obok
 * logowania lokalnego).
 */
async function zapytajODrugaInstancje({ skad, ja, on }) {
  const wybor = await dialog.showMessageBox(win ?? undefined, {
    type: 'question',
    title: t('secondInstance.title'),
    message: t('secondInstance.title'),
    detail: `${t('secondInstance.running')}\n${ja}\n\n`
      + `${t('secondInstance.launched')}\n${on}\n\n${t('secondInstance.question')}`,
    buttons: [t('secondInstance.keep'), t('secondInstance.create')],
    defaultId: 0,
    // Escape ma znaczyć „nic nie zmieniaj" — zakładanie katalogu obok cudzego
    // pliku nie może być skutkiem przypadkowego zamknięcia okna.
    cancelId: 0,
    noLink: true,
  });
  if (wybor.response !== 1) return;

  try {
    const { katalog, porty, byloJuz } = await zalozKatalogDanych({
      plik: skad, przykladowy: examplePath(),
    });
    log.info(`Druga instancja: katalog ${katalog}`
      + `${byloJuz ? ' (konfiguracja już była — nie ruszam)' : ''}`
      + `${porty ? `, porty UDP ${porty.udp} i API ${porty.api}` : ''}`
      + `${porty?.tcp ? `, TCP dla Logger32 ${porty.tcp}` : ''}`);
    // Druga instancja już się zamknęła (nie dostała blokady), więc trzeba ją
    // uruchomić na nowo — tym razem trafi na własny katalog danych.
    spawn(skad, [], { detached: true, stdio: 'ignore' }).unref();
    await dialog.showMessageBox(win ?? undefined, {
      type: 'info',
      title: t('secondInstance.createdTitle'),
      message: t('secondInstance.createdTitle'),
      detail: `${katalog}\n\n`
        + (porty
          ? `${t('secondInstance.ports').replace('{udp}', porty.udp).replace('{api}', porty.api)
            .replace('{tcp}', porty.tcp ?? '—')}\n\n`
          : '')
        + t('secondInstance.createdHint'),
      buttons: [t('secondInstance.ok')],
      noLink: true,
    });
  } catch (err) {
    // Najczęstszy przypadek: plik leży w miejscu bez prawa zapisu (/opt,
    // pendrive tylko do odczytu, katalog Program Files).
    log.error(`Druga instancja: nie mogę założyć katalogu: ${err.message}`);
    await dialog.showMessageBox(win ?? undefined, {
      type: 'error',
      title: t('secondInstance.failedTitle'),
      message: t('secondInstance.failedTitle'),
      detail: `${err.message}\n\n${t('secondInstance.failedHint')
        .replace('{katalog}', KATALOG_PRZENOSNY)}`,
      buttons: [t('secondInstance.ok')],
      noLink: true,
    });
  }
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
// Stan ikony tuż po `new Tray(iconFor('ok'))` — bez tego pierwsze odświeżenie
// ustawiałoby ten sam obrazek drugi raz.
let lastTrayIcon = 'ok';
let lastTrayTip = '';

function refreshTray() {
  if (!tray) return;
  const { state, tip } = trayState();

  // Ikonę i dymek ustawiamy TYLKO przy zmianie — tak samo jak menu niżej.
  // Zegar chodzi co 3 sekundy, a stan zmienia się rzadko. Na XFCE ikona jest
  // osadzona w panelu przez XEmbed i każde `setImage` to ruch na oknie
  // osadzonym w cudzym procesie; wtyczka zasobnika xfce4-panel 4.18 potrafi
  // się przy pracy z tą ikoną wywrócić, więc nie dokładamy jej roboty.
  if (state !== lastTrayIcon) {
    lastTrayIcon = state;
    tray.setImage(iconFor(state));
  }
  const dymek = `${t('app.name')} — ${tip}`;
  if (dymek !== lastTrayTip) {
    lastTrayTip = dymek;
    tray.setToolTip(dymek);
  }

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

// Najmniejszy sensowny rozmiar STRONY (okno jest o ramkę większe, patrz
// `ustawMinimalnyRozmiar`). Z pomiaru, nie z oka: przy 344 px nagłówek mieści
// się w dwóch wierszach, przy 343 px „Zakończ" spada do trzeciego. Pionowy
// pasek przewijania zabiera stronie kolejne 15 px, więc okno potrzebuje 359 —
// zaokrąglone do 360, czyli dokładnie tyle, ile najwęższy telefon, pod który
// jest robiony układ w `index.html`.
//
// Mierzyć trzeba W OKNIE, nie na stronie z przeglądarki: tam nie ma przycisku
// „Zakończ" (brak `window.bridge.quit`) i próg wychodzi o 44 px za niski.
//
// Na 320 px wysokości widok prosty pokazuje nagłówek, linijkę stanu, obie
// liczby i początek listy, a pełny — nagłówek razem z paskiem zakładek.
const MIN_TRESC = { szer: 360, wys: 320 };

/** Rozmiar okna przy PIERWSZYM uruchomieniu — potem decyduje zapamiętany. */
const OKNO_STARTOWE = { szer: 900, wys: 700 };

/**
 * Zapamiętany rozmiar okna — albo nic, gdy go nie ma lub nie mieści się już
 * na żadnym ekranie.
 *
 * Sprawdzamy WIDOCZNOŚĆ, a nie samo istnienie liczb: po odłączeniu drugiego
 * monitora zapisane współrzędne wskazują pustkę, a okno otwarte tam jest dla
 * człowieka nie do odróżnienia od nieuruchomionego programu.
 */
function zapamietanyRozmiar() {
  const o = daemon?.getConfig?.()?.ui?.window;
  if (!o || !Number.isFinite(o.width) || !Number.isFinite(o.height)) return null;
  const wynik = { width: o.width, height: o.height, maximized: !!o.maximized };
  if (Number.isFinite(o.x) && Number.isFinite(o.y)) {
    const widoczne = screen.getAllDisplays().some((d) => {
      const p = d.workArea;
      // Wystarczy, że widać kawałek paska tytułu — inaczej okno zapisane
      // częściowo poza krawędzią byłoby odrzucane bez powodu.
      return o.x + o.width > p.x + 40 && o.x < p.x + p.width - 40
        && o.y >= p.y - 10 && o.y < p.y + p.height - 40;
    });
    if (widoczne) { wynik.x = o.x; wynik.y = o.y; }
  }
  return wynik;
}

function showWindow() {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return;
  }
  // Rozmiar i położenie z poprzedniego uruchomienia — jeśli są i jeśli nadal
  // mieszczą się na którymś ekranie. Monitor bywa odłączony między sesjami
  // i okno zapisane na nim otworzyłoby się poza widokiem, czyli dla człowieka
  // po prostu by zniknęło.
  const zapamietane = zapamietanyRozmiar();
  win = new BrowserWindow({
    width: zapamietane?.width ?? OKNO_STARTOWE.szer,
    height: zapamietane?.height ?? OKNO_STARTOWE.wys,
    ...(zapamietane?.x !== undefined ? { x: zapamietane.x, y: zapamietane.y } : {}),
    title: 'RadioDyplom Bridge',
    icon: iconFor('ok'),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);

  // Minimalny rozmiar okna. Bez niego okno daje się ścisnąć do kilku pikseli:
  // nie widać już nic, a trafienie myszą w krawędź, żeby je rozciągnąć,
  // to zabawa w celowanie.
  //
  // `setMinimumSize` mówi o OKNIE razem z ramką i belką tytułu, a MIN_TRESC
  // o stronie — różnicę bierzemy z żywego okna, bo zależy od systemu i motywu.
  //
  // Mnożymy przez powiększenie (Ctrl +), bo ono skaluje całą stronę: przy 200%
  // okno szerokie na 320 px pokazuje stronę o szerokości 160 px, czyli nagłówek
  // w czterech wierszach. Minimum przycinamy do obszaru roboczego ekranu, żeby
  // nigdy nie było większe od miejsca, w którym okno ma stanąć.
  const ustawMinimalnyRozmiar = (zoom) => {
    if (!win || win.isDestroyed()) return;
    const z = Math.max(0.8, Math.min(3, Number(zoom) || 1));
    const [szerOkna, wysOkna] = win.getSize();
    const [szerTresci, wysTresci] = win.getContentSize();
    const praca = screen.getPrimaryDisplay().workAreaSize;
    win.setMinimumSize(
      Math.min(Math.round(MIN_TRESC.szer * z) + Math.max(0, szerOkna - szerTresci), praca.width),
      Math.min(Math.round(MIN_TRESC.wys * z) + Math.max(0, wysOkna - wysTresci), praca.height),
    );
  };
  ustawMinimalnyRozmiar(daemon?.getConfig?.()?.ui?.zoom);

  // Gdy interfejs nie wstanie, człowiek widzi białe okno i nic więcej — a log
  // milczy, bo rdzeń pracuje dalej i nie ma o czym pisać. Zgłoszenie
  // z przycisku „Zapisz zgłoszenie do wysłania" bierze ten sam log, więc też
  // milczy. Te nasłuchy niczego nie naprawiają; mają zostawić ślad, po którym
  // da się odróżnić „strona się nie wczytała" od „strona się wczytała i padła".
  // Zakładamy je PRZED `loadFile`, bo inaczej przegapimy wypadki pierwszego
  // wczytania.
  const wc = win.webContents;
  wc.on('did-fail-load', (_zdarzenie, kod, opis, adres, glownaRamka) => {
    // -3 to ABORTED: zwykłe przerwanie nawigacji, nie awaria.
    if (kod === -3) return;
    log.error(`Interfejs się nie wczytał (${kod} ${opis})`
      + `${glownaRamka ? '' : ' — ramka podrzędna'}: ${adres}`);
  });
  wc.on('preload-error', (_zdarzenie, sciezka, blad) => {
    log.error(`Preload okna padł: ${blad?.message || blad} (${sciezka})`);
  });
  wc.on('render-process-gone', (_zdarzenie, szczegoly) => {
    log.error(`Proces interfejsu zniknął: ${szczegoly.reason}, kod ${szczegoly.exitCode}`);
  });
  // Pętla błędów w rendererze potrafi sypać kilkadziesiąt linii na sekundę
  // i wypchnąć z bufora logu wszystko inne — dlatego liczymy i milkniemy.
  let bledowKonsoli = 0;
  wc.on('console-message', (zdarzenie) => {
    if (zdarzenie.level !== 'error') return;
    bledowKonsoli += 1;
    if (bledowKonsoli > 20) return;
    const skad = zdarzenie.sourceId ? ` (${zdarzenie.sourceId}:${zdarzenie.lineNumber})` : '';
    log.error(`Błąd w interfejsie: ${zdarzenie.message}${skad}`);
    if (bledowKonsoli === 20) log.warn('Dalsze błędy interfejsu pomijam — to już dwudziesty');
  });
  win.on('unresponsive', () => log.warn('Okno nie odpowiada'));
  win.on('responsive', () => log.info('Okno znów odpowiada'));

  win.loadFile(join(__dirname, 'index.html'));

  // Zapis rozmiaru. Dławiony, bo `resize` leci przy KAŻDYM pikselu
  // przeciągania — bez tego zapisywalibyśmy konfigurację kilkadziesiąt razy
  // na sekundę.
  //
  // Rozmiar sprzed zmaksymalizowania pamiętamy SAMI, zamiast ufać
  // `getNormalBounds()`. Zmierzone na żywym oknie (xfwm4): gdy maksymalizuje
  // MENEDŻER OKIEN, a nie program, `getNormalBounds()` oddaje rozmiar ekranu
  // — i do pliku trafiało 1400×995 zamiast 1180×640. Po odmaksymalizowaniu
  // okno wracałoby wtedy na cały ekran, a wybrany rozmiar przepadał.
  let zapisOkna = null;
  let ostatniNormalny = null;
  /**
   * Czy te wymiary to w praktyce „na cały ekran"?
   *
   * Flaga `isMaximized()` NIE wystarcza: gdy maksymalizuje menedżer okien,
   * zdarzenie `resize` przychodzi, zanim Electron się o tym dowie, więc
   * w tej chwili flaga jest jeszcze fałszywa i rozmiar ekranu zostałby
   * zapamiętany jako „normalny". Zmierzone na xfwm4: do pliku trafiało
   * 1400×995 zamiast 1180×640.
   */
  const naCalyEkran = (b) => {
    const praca = screen.getDisplayMatching(b).workArea;
    return Math.abs(b.width - praca.width) <= 8 && Math.abs(b.height - praca.height) <= 8;
  };
  const zapiszRozmiar = () => {
    if (win && !win.isDestroyed() && !win.isMinimized() && !win.isMaximized()) {
      const b = win.getBounds();
      if (!naCalyEkran(b)) ostatniNormalny = b;
    }
    clearTimeout(zapisOkna);
    zapisOkna = setTimeout(() => {
      if (!win || win.isDestroyed() || win.isMinimized()) return;
      const b = ostatniNormalny || win.getNormalBounds();
      try {
        daemon?.saveConfig?.({ ui: { window: { ...b, maximized: win.isMaximized() } } });
      } catch { /* rdzeń jeszcze wstaje albo już go nie ma */ }
    }, 800);
  };
  win.on('resize', zapiszRozmiar);
  win.on('move', zapiszRozmiar);
  win.on('maximize', zapiszRozmiar);
  win.on('unmaximize', zapiszRozmiar);

  if (zapamietane?.maximized) win.maximize();

  // Zamknięcie okna chowa aplikację do zasobnika – daemon ma pracować dalej.
  win.on('close', (e) => {
    // Zapisujemy OD RAZU, bez dławienia: zamknięcie może nastąpić przed
    // upływem opóźnienia i ostatnia zmiana rozmiaru by przepadła.
    clearTimeout(zapisOkna);
    if (!win.isDestroyed() && !win.isMinimized()) {
      if (!win.isMaximized()) {
        const b = win.getBounds();
        if (!naCalyEkran(b)) ostatniNormalny = b;
      }
      const b = ostatniNormalny || win.getNormalBounds();
      try {
        daemon?.saveConfig?.({ ui: { window: { ...b, maximized: win.isMaximized() } } });
      } catch { /* rdzeń mógł już zejść */ }
    }
    if (!quitting) { e.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; });

  // Powiększanie okna: Ctrl +, Ctrl -, Ctrl 0.
  //
  // Po co, skoro jest już skalowanie czcionki (ikona w nagłówku): to skaluje
  // WSZYSTKO — czcionkę, odstępy, ikony i grubość ramek — czyli działa też
  // tam, gdzie sama czcionka nie wystarcza. Zapisujemy wybór, bo kto
  // potrzebuje większego widoku, potrzebuje go przy każdym starcie.
  //
  // Program nie ma paska menu (żyje w zasobniku), więc nie ma gdzie powiesić
  // akceleratorów — łapiemy klawisze przed przekazaniem ich stronie.
  const zoomZapisz = (z) => {
    try { daemon?.saveConfig?.({ ui: { zoom: z } }); } catch { /* rdzeń jeszcze wstaje */ }
  };
  win.webContents.on('before-input-event', (zdarzenie, klawisz) => {
    if (klawisz.type !== 'keyDown' || !(klawisz.control || klawisz.meta)) return;
    // `+` bywa pod różnymi nazwami: „+", „=", a na klawiaturze numerycznej
    // „Add". Bez tego skrót działał tylko na jednym układzie klawiatury.
    const wPlus = ['+', '=', 'Add'].includes(klawisz.key);
    const wMinus = ['-', '_', 'Subtract'].includes(klawisz.key);
    const wZero = klawisz.key === '0';
    if (!wPlus && !wMinus && !wZero) return;
    zdarzenie.preventDefault();
    const teraz = win.webContents.getZoomFactor();
    const nowy = wZero ? 1
      : Math.max(0.8, Math.min(3, Number((teraz + (wPlus ? 0.1 : -0.1)).toFixed(2))));
    win.webContents.setZoomFactor(nowy);
    ustawMinimalnyRozmiar(nowy);
    zoomZapisz(nowy);
    log.info(`Powiększenie okna: ${Math.round(nowy * 100)}%`);
  });

  // Zapamiętane powiększenie stosujemy PO wczytaniu strony: `setZoomFactor`
  // ustawione wcześniej jest gubione przy nawigacji.
  win.webContents.on('did-finish-load', () => {
    const z = Number(daemon?.getConfig?.()?.ui?.zoom) || 1;
    // ZAWSZE, także dla 1: Chromium pamięta powiększenie sam (per adres) i bez
    // jawnego ustawienia jego pamięć wygrywała z konfiguracją — okno wstawało
    // powiększone, choć w pliku było `zoom: 1`. Zobaczone na zrzucie.
    win.webContents.setZoomFactor(Math.max(0.8, Math.min(3, z)));
    // Dopiero teraz okno jest obrysowane przez menedżera okien, więc różnica
    // między oknem a treścią jest prawdziwa — przy tworzeniu bywa zerowa.
    ustawMinimalnyRozmiar(z);
    // Szczypanie dwoma palcami na ekranach dotykowych i gładzikach.
    win.webContents.setVisualZoomLevelLimits(1, 3).catch(() => {});
  });
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

  // Zasiew ROBIMY SAMI, żeby wiedzieć, czy konfiguracja właśnie powstała —
  // tylko wtedy wolno ruszać porty. Później są decyzją użytkownika.
  if (ensureConfig()) {
    const porty = await dostosujPortyPrzyZasiewie(configPath());
    if (porty) {
      // Mówimy o tym, co NAPRAWDĘ przestawiliśmy. Wyliczanie wszystkich portów
      // kazałoby zgadywać, który z nich jest nowy — a przepisać do loggera
      // trzeba właśnie ten.
      if (porty.zmienione.includes('udp')) {
        log.warn(`Domyślne porty są zajęte — ta instancja dostała UDP ${porty.udp} `
          + `i interfejs ${porty.api}. Logger musi wysyłać na ${porty.udp}.`);
      }
      if (porty.zmienione.includes('tcp')) {
        log.warn(`Port TCP dla Logger32 był zajęty — ta instancja dostała ${porty.tcp}. `
          + 'Wpisz ten sam numer w Logger32 (Config w oknie TCP client event viewer).');
      }
    }
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

  // --- most IPC: renderer nie ma dostępu do Node, wszystko idzie tędy ---
  // Rejestrujemy je PRZED otwarciem okna — patrz komentarz przy showWindow()
  // na końcu tego bloku.
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

  // OKNO OTWIERAMY NA KOŃCU, po rejestracji wszystkich mostów IPC.
  //
  // Renderer pyta o konfigurację i stan natychmiast po wczytaniu strony.
  // Gdy zdąży przed `ipcMain.handle`, `invoke` rzuca „No handler registered
  // for 'config:get'", wyjątek przerywa budowanie widoku i w oknie zostaje
  // pusty szkielet: zakładki i ramki bez jednego napisu, bez komunikatu
  // o błędzie. Wyścig wygrywało zwykle okno, więc objaw był rzadki
  // i nieodtwarzalny na żądanie — odtworzony doświadczalnie 12.10.2026
  // przez opóźnienie rejestracji o 4 s.
  //
  // Kolejność jest tu jedynym zabezpieczeniem: `ipcRenderer.invoke` nie czeka
  // na handler, który jeszcze nie istnieje. Pilnuje tego test.
  showWindow();
});

// Sama subskrypcja tego zdarzenia wyłącza domyślne „zamknij okno = zakończ aplikację".
// Aplikacja ma żyć w zasobniku; kończy ją wyłącznie pozycja „Zakończ" w menu.
app.on('window-all-closed', () => { /* celowo nic – patrz komentarz */ });

// Na macOS kliknięcie ikony w Docku (lub przełączenie aplikacji) przywraca okno.
app.on('activate', () => {
  showWindow();
});

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
