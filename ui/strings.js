// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Tłumaczenia interfejsu. JEDEN słownik dla okna i dla zasobnika — dwie kopie
// rozjechałyby się, co już raz w tym projekcie zdążyło się stać przy logice stanu.
//
// Moduł ESM: proces główny Electrona importuje go bezpośrednio, a renderer
// przez <script type="module">.

export const LANGS = ['pl', 'en'];
export const LANG_NAMES = { pl: 'Polski', en: 'English' };

const DICT = {
  pl: {
    'app.name': 'RadioDyplom Bridge',

    'tab.state': 'Stan',
    'tab.queue': 'Kolejka',
    'tab.config': 'Konfiguracja',
    'tab.about': 'O programie',
    'tab.log': 'Log',

    'btn.pause': 'Wstrzymaj',
    'btn.resume': 'Wznów',
    'btn.requeue': 'Ponów odrzucone',
    'btn.save': 'Zapisz',
    'btn.addTarget': 'Dodaj stację',
    'btn.remove': 'Usuń',
    'btn.quit': 'Zakończ',
    'btn.openLog': 'Pokaż plik logu',
    'btn.licenseText': 'Pełny tekst licencji',
    'btn.repo': 'Repozytorium',
    'btn.releases': 'Wydania',
    'confirm.quit': 'Zakończyć mostek? Do czasu ponownego uruchomienia QSO z loggera '
      + 'nie będą przekazywane.',
    'hint.closeToTray': 'Zamknięcie okna nie kończy programu — mostek pracuje dalej '
      + 'w zasobniku. Aby go zakończyć, użyj przycisku „Zakończ".',

    'card.sent': 'Wysłane',
    'card.pending': 'W kolejce',
    'card.failed': 'Odrzucone',
    'card.received': 'Odebrane z loggera',
    'card.skipped': 'Pominięte (duplikaty)',

    'panel.listen': 'Nasłuch',
    'panel.sources': 'Źródła',
    'panel.lastEvents': 'Ostatnie zdarzenia',
    'panel.pending': 'Oczekujące',
    'panel.rejected': 'Odrzucone',
    'panel.connection': 'Połączenie z radiodyplom',
    'panel.udp': 'Nasłuch UDP',
    'panel.fanout': 'Rozmnażanie QSO na wiele stacji',
    'panel.language': 'Język',
    'panel.about': 'O programie',
    'panel.license': 'Licencja',

    'th.callsign': 'Znak',
    'th.station': 'Stacja',
    'th.operator': 'Operator',
    'th.attempts': 'Próby',
    'th.error': 'Błąd',
    'th.reason': 'Powód',

    'label.pin': 'PIN API (profil użytkownika)',
    'label.dryRun': 'Tryb próbny (nic nie wysyła na serwer)',
    'label.address': 'Adres',
    'label.port': 'Port',
    'label.multicast': 'Grupy multicast (po przecinku, np. 224.0.0.222)',
    'label.stationCall': 'Znak stacji',
    'label.operator': 'Operator (opcjonalnie)',
    'label.language': 'Język interfejsu',

    'hint.pin': 'Zostaw zamaskowany, żeby nie zmieniać. Wpisz nowy, aby podmienić.',
    'hint.multicast': 'puste = brak',
    'about.program': 'Program',
    'about.version': 'Wersja',
    'about.author': 'Autor',
    'about.license': 'Licencja',
    'about.gpl': 'To wolne oprogramowanie: możesz je rozpowszechniać i modyfikować '
      + 'na warunkach Powszechnej Licencji Publicznej GNU w wersji 3 albo dowolnej '
      + 'późniejszej. Program jest udostępniany <b>bez żadnej gwarancji</b> — '
      + 'nawet bez rękojmi przydatności handlowej czy przydatności do określonego celu.',
    'hint.releases': 'Program nie aktualizuje się sam. Zajrzyj do „Wydań", żeby sprawdzić, '
      + 'czy nie ma nowszej wersji.',
    'hint.targetIncomplete': 'NIE ZAPISANO — każda pozycja wymaga znaku stacji.',
    'hint.fanout': 'Puste = jedno QSO ze znakiem stacji z loggera. Każdy znak stacji musi '
      + 'być na liście stacji Twojego konta w Managerze — inaczej serwer nie zapisze kopii.',
    'hint.requeue': '„Ponów odrzucone" wraca do kolejki tylko te, które padły z powodu '
      + 'awarii łączności. Odrzucone przez serwer (zły znak, brak uprawnień) zostają.',
    'hint.saved': 'Zapisano i zastosowano.',
    'hint.savedRestart': 'Zapisano. Wymaga restartu: ',
    'hint.saveFailed': 'NIE ZAPISANO —',

    'opt.localhost': '127.0.0.1 — tylko ten komputer',
    'opt.anyhost': '0.0.0.0 — cała sieć lokalna (i rozgłoszeniowe)',

    'note.localhost': 'Nasłuch tylko na localhost. Jeśli logger działa na innym komputerze '
      + 'albo wysyła rozgłoszeniowo, ustaw adres 0.0.0.0 w zakładce Konfiguracja.',
    'note.anyhost': 'Adres 0.0.0.0 otwiera port na całą sieć lokalną — każdy w tej sieci '
      + 'może wtedy dopisać QSO do Twojej akcji.',

    'empty.sources': 'Brak odebranych datagramów',
    'empty.queue': 'Kolejka pusta',
    'empty.none': 'Brak',
    'empty.nothing': 'Nic jeszcze nie przeszło',

    'state.ok': 'Działa',
    'state.paused': 'Wysyłka wstrzymana',
    'state.offline': 'Brak łączności z radiodyplom',
    'state.rejected': 'Odrzucone QSO: ',
    'state.noPin': 'brak PIN-u API',
    'state.noConn': 'brak łączności',
    'state.coreDown': 'Rdzeń nie wystartował',

    'msg.noPinHint': 'Brak PIN-u API. Wpisz go w zakładce Konfiguracja — '
      + 'do tego czasu nic nie zostanie wysłane.',
    'msg.lastSent': 'Ostatnie wysłane: ',
    'msg.lastError': 'Ostatni błąd: ',
    'msg.action': 'akcja ',
    'msg.autoResend': ' (dosyłam automatycznie)',
    'msg.inQueue': 'w kolejce: ',
    'msg.sentCount': 'wysłane: ',

    'restart.banner': 'Zapisane zmiany zaczną obowiązywać po ponownym uruchomieniu programu: ',
    'restart.tray': 'wymaga restartu',

    'tray.show': 'Pokaż okno',
    'tray.pause': 'Wstrzymaj wysyłkę',
    'tray.resume': 'Wznów wysyłkę',
    'tray.requeue': 'Ponów odrzucone',
    'tray.openConfig': 'Otwórz plik konfiguracji',
    'tray.openLog': 'Pokaż plik logu',
    'tray.quit': 'Zakończ',

    // Kody błędów z API — komunikat serwera przychodzi po polsku, więc dla
    // interfejsu angielskiego tłumaczymy po kodzie, a treść serwera zostaje w tle.
    'err.INVALID_CALLSIGN': 'Nieprawidłowy znak korespondenta',
    'err.INVALID_API_KEY': 'Nieprawidłowy PIN API albo konto nieaktywne',
    'err.MISSING_API_KEY': 'Brak PIN-u API',
    'err.INVALID_QSO_DATA': 'Brak wymaganych danych QSO',
    'err.NOT_SAVED': 'Serwer przyjął QSO, ale nie zapisał go do żadnej akcji '
      + '(znak stacji bez uprawnień?)',
    'err.METHOD_NOT_ALLOWED': 'Niedozwolona metoda żądania',
    'btn.ackProblems': 'Wyczyść sygnalizację problemów',
    'panel.view': 'Widok',
    'label.recentEvents': 'Ile ostatnich zdarzeń pokazywać',
    'hint.recentEvents': 'Od 5 do 200. Dotyczy panelu „Ostatnie zdarzenia" na zakładce Stan.',
    'card.sentDry': '(próbnie)',
    'hint.dryRun': 'Nic nie leci na serwer. Uwaga: QSO przepuszczone próbnie zostaje '
      + 'zamknięte w deduplikacji i NIE poleci po wyłączeniu trybu próbnego. '
      + 'Jeśli chcesz tylko przytrzymać QSO na później, użyj „Wstrzymaj”.',
    'badge.problems': 'PROBLEMY:',
    'hint.problemBadge': 'Kliknij, aby wyczyścić sygnalizację. Odrzucone QSO zostają '
      + 'w kolejce — zobaczysz je na zakładce Kolejka.',
    'confirm.ackProblems': 'Wyczyścić sygnalizację problemów?\n\nOdrzucone QSO zostaną '
      + 'w kolejce i nadal będzie można je ponowić. Sygnalizacja zapali się '
      + 'ponownie przy następnym odrzuconym QSO.',
    'hint.ackProblems': 'Kasuje samą sygnalizację. Odrzucone QSO zostają w kolejce.',
    'ev.sent': 'wysłane',
    'ev.dryrun': 'próbnie — NIE wysłane',
    'ev.duplicate': 'duplikat',
    'ev.retry': 'ponowię',
    'ev.rejected': 'ODRZUCONE',
    'ev.exhausted': 'PORZUCONE po próbach',
  },

  en: {
    'app.name': 'RadioDyplom Bridge',

    'tab.state': 'Status',
    'tab.queue': 'Queue',
    'tab.config': 'Settings',
    'tab.about': 'About',
    'tab.log': 'Log',

    'btn.pause': 'Pause',
    'btn.resume': 'Resume',
    'btn.requeue': 'Retry rejected',
    'btn.save': 'Save',
    'btn.addTarget': 'Add station',
    'btn.remove': 'Remove',
    'btn.quit': 'Quit',
    'btn.openLog': 'Show log file',
    'btn.licenseText': 'Full license text',
    'btn.repo': 'Repository',
    'btn.releases': 'Releases',
    'confirm.quit': 'Quit the bridge? QSOs from the logger will not be forwarded '
      + 'until you start it again.',
    'hint.closeToTray': 'Closing the window does not quit the program — the bridge '
      + 'keeps running in the tray. Use the “Quit” button to stop it.',

    'card.sent': 'Uploaded',
    'card.pending': 'Queued',
    'card.failed': 'Rejected',
    'card.received': 'Received from logger',
    'card.skipped': 'Skipped (duplicates)',

    'panel.listen': 'Listening',
    'panel.sources': 'Sources',
    'panel.lastEvents': 'Recent events',
    'panel.pending': 'Waiting',
    'panel.rejected': 'Rejected',
    'panel.connection': 'radiodyplom connection',
    'panel.udp': 'UDP listener',
    'panel.fanout': 'Duplicate QSO to several stations',
    'panel.language': 'Language',
    'panel.about': 'About',
    'panel.license': 'License',

    'th.callsign': 'Call',
    'th.station': 'Station',
    'th.operator': 'Operator',
    'th.attempts': 'Tries',
    'th.error': 'Error',
    'th.reason': 'Reason',

    'label.pin': 'API PIN (user profile)',
    'label.dryRun': 'Dry run (nothing is sent to the server)',
    'label.address': 'Address',
    'label.port': 'Port',
    'label.multicast': 'Multicast groups (comma separated, e.g. 224.0.0.222)',
    'label.stationCall': 'Station callsign',
    'label.operator': 'Operator (optional)',
    'label.language': 'Interface language',

    'hint.pin': 'Leave it masked to keep the current PIN. Type a new one to replace it.',
    'hint.multicast': 'empty = none',
    'about.program': 'Program',
    'about.version': 'Version',
    'about.author': 'Author',
    'about.license': 'License',
    'about.gpl': 'This is free software: you may redistribute and modify it under the '
      + 'terms of the GNU General Public License, version 3 or any later version. '
      + 'It comes with <b>absolutely no warranty</b> — not even the implied warranty '
      + 'of merchantability or fitness for a particular purpose.',
    'hint.releases': 'The program does not update itself. Check “Releases” to see whether '
      + 'a newer version is available.',
    'hint.targetIncomplete': 'NOT SAVED — every row needs a station callsign.',
    'hint.fanout': 'Empty = one QSO with the station callsign from the logger. Every station '
      + 'callsign must be on your account\'s station list in the Manager — otherwise the '
      + 'server will not store that copy.',
    'hint.requeue': '“Retry rejected” only requeues QSOs that failed due to connectivity. '
      + 'Those rejected by the server (bad callsign, no permission) stay.',
    'hint.saved': 'Saved and applied.',
    'hint.savedRestart': 'Saved. Restart required for: ',
    'hint.saveFailed': 'NOT SAVED —',

    'opt.localhost': '127.0.0.1 — this computer only',
    'opt.anyhost': '0.0.0.0 — whole local network (incl. broadcast)',

    'note.localhost': 'Listening on localhost only. If the logger runs on another computer '
      + 'or broadcasts, set the address to 0.0.0.0 in Settings.',
    'note.anyhost': 'Address 0.0.0.0 opens the port to the whole local network — anyone on '
      + 'it could then add QSOs to your award activity.',

    'empty.sources': 'No datagrams received',
    'empty.queue': 'Queue is empty',
    'empty.none': 'None',
    'empty.nothing': 'Nothing has gone through yet',

    'state.ok': 'Running',
    'state.paused': 'Uploading paused',
    'state.offline': 'No connection to radiodyplom',
    'state.rejected': 'Rejected QSOs: ',
    'state.noPin': 'no API PIN',
    'state.noConn': 'no connection',
    'state.coreDown': 'Core failed to start',

    'msg.noPinHint': 'No API PIN. Enter it in Settings — nothing will be uploaded until then.',
    'msg.lastSent': 'Last uploaded: ',
    'msg.lastError': 'Last error: ',
    'msg.action': 'activity ',
    'msg.autoResend': ' (retrying automatically)',
    'msg.inQueue': 'queued: ',
    'msg.sentCount': 'uploaded: ',

    'restart.banner': 'Saved changes take effect after restarting the program: ',
    'restart.tray': 'restart required',

    'tray.show': 'Show window',
    'tray.pause': 'Pause uploading',
    'tray.resume': 'Resume uploading',
    'tray.requeue': 'Retry rejected',
    'tray.openConfig': 'Open config file',
    'tray.openLog': 'Show log file',
    'tray.quit': 'Quit',

    'err.INVALID_CALLSIGN': 'Invalid worked callsign',
    'err.INVALID_API_KEY': 'Invalid API PIN or inactive account',
    'err.MISSING_API_KEY': 'API PIN missing',
    'err.INVALID_QSO_DATA': 'Required QSO fields missing',
    'err.NOT_SAVED': 'Server accepted the QSO but stored it in no activity '
      + '(station callsign without permission?)',
    'err.METHOD_NOT_ALLOWED': 'Request method not allowed',
    'btn.ackProblems': 'Clear problem indicator',
    'panel.view': 'View',
    'label.recentEvents': 'How many recent events to show',
    'hint.recentEvents': 'Between 5 and 200. Applies to the “Recent events” panel on the Status tab.',
    'card.sentDry': '(dry run)',
    'hint.dryRun': 'Nothing is sent to the server. Note: a QSO passed through in dry run '
      + 'is marked as handled and will NOT be sent after you turn dry run off. '
      + 'To merely hold QSOs for later, use “Pause”.',
    'badge.problems': 'PROBLEMS:',
    'hint.problemBadge': 'Click to clear the indicator. Rejected QSOs stay in the queue '
      + '— you will find them on the Queue tab.',
    'confirm.ackProblems': 'Clear the problem indicator?\n\nRejected QSOs stay in the queue '
      + 'and can still be retried. The indicator will light up again on the next '
      + 'rejected QSO.',
    'hint.ackProblems': 'Clears the indicator only. Rejected QSOs stay in the queue.',
    'ev.sent': 'sent',
    'ev.dryrun': 'dry run — NOT sent',
    'ev.duplicate': 'duplicate',
    'ev.retry': 'will retry',
    'ev.rejected': 'REJECTED',
    'ev.exhausted': 'GIVEN UP after retries',
  },
};

let current = 'pl';

export function setLang(lang) {
  current = DICT[lang] ? lang : 'pl';
  return current;
}

export function getLang() {
  return current;
}

/** Tłumaczenie; brak klucza zwraca sam klucz, żeby braki były widoczne. */
export function t(key) {
  return DICT[current]?.[key] ?? DICT.pl[key] ?? key;
}

/**
 * Komunikat błędu API. Serwer odpowiada po polsku, więc gdy znamy kod,
 * pokazujemy własny tekst; treść serwera zostaje jako uzupełnienie.
 */
export function errText(code, serverMessage) {
  if (code && DICT[current]?.[`err.${code}`]) {
    const own = t(`err.${code}`);
    return current === 'pl' || !serverMessage ? own : `${own} (${serverMessage})`;
  }
  return serverMessage || code || t('state.offline');
}
