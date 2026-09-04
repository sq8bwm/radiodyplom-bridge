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
    'tab.stats': 'Statystyki',
    'panel.statsRange': 'Zakres',
    'range.today': 'Dziś',
    'range.week': '7 dni',
    'range.month': '30 dni',
    'range.all': 'Wszystko',
    'stats.empty': 'Dziennik jest pusty. Zapełnia się przy każdym wysłanym QSO; '
      + 'historię sprzed wersji 0.1.10 można wczytać z logów narzędziem import-log.',
    'stats.qso': 'QSO',
    'stats.copies': 'Kopie',
    'stats.qsoShort': 'QSO',
    'stats.copiesShort': 'kopii',
    'stats.days': 'Dni w eterze',
    'stats.perDayAvg': 'średnio {n} QSO na dzień',
    'stats.first': 'Pierwsze QSO',
    'stats.last': 'Ostatnie',
    'stats.perDay': 'Po dniach',
    'stats.perAction': 'Po akcjach',
    'stats.perOperator': 'Po operatorach',
    'stats.perStation': 'Po stacjach',
    'stats.perBand': 'Po pasmach',
    'stats.perMode': 'Po emisjach',
    'stats.perSource': 'Po loggerach',
    'stats.topCalls': 'Najczęściej pracowane',
    'stats.calls': 'Różnych znaków',
    'stats.stationsCount': 'spod {n} stacji',
    'tip.statsCalls': 'Ile RÓŻNYCH znaków korespondentów. Lista „najczęściej '
      + 'pracowane" pokazuje tylko czoło tej listy.',
    'stats.more': '… i {n} więcej',
    'tip.statsQso': 'Liczba ŁĄCZNOŚCI. Kopie to ta sama łączność wysłana na kilka '
      + 'znaków stacji — jedno QSO na trzy stacje to trzy kopie.',
    'tip.statsDays': 'Dni, w których było choć jedno QSO. Średnia liczona przez te '
      + 'dni, nie przez długość zakresu — tydzień z jedną sobotą w eterze inaczej '
      + 'wyglądałby na katastrofę.',
    'tab.log': 'Log',

    'btn.pause': 'Wstrzymaj',
    'btn.resume': 'Wznów',
    'btn.requeue': 'Ponów odrzucone',
    'btn.save': 'Zapisz',
    'btn.addTarget': 'Dodaj stację',
    'btn.remove': 'Usuń',
    'btn.confirmYes': 'Tak',
    'btn.confirmNo': 'Anuluj',
    'btn.quit': 'Zakończ',
    'btn.openLog': 'Pokaż plik logu',
    'btn.logEnd': 'Na koniec',
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
    'label.targetOn': 'Aktywna',
    'label.stationCall': 'Znak stacji',
    'label.operator': 'Operator (opcjonalnie)',
    'label.targetPin': 'PIN konta (opcjonalnie)',
    'label.language': 'Język interfejsu',

    'hint.pin': 'Zostaw zamaskowany, żeby nie zmieniać. Wpisz nowy, aby podmienić.',
    'hint.multicast': 'puste = brak',
    'hint.logFollowing': 'nadąża za logiem',
    'hint.logPaused': 'przewinięte w górę — nowe wpisy dochodzą na dole',
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
    'hint.targetOn': 'Odznacz, żeby wyłączyć tę regułę bez usuwania jej danych.',
    'hint.targetPin': 'puste = PIN główny',
    'hint.targetPinLong': 'PIN konta, z którego ma polecieć ta kopia. Potrzebny tylko, '
      + 'gdy ta stacja NIE jest przypisana do Twojego konta. Zostaw zamaskowany, '
      + 'żeby nie zmieniać; wyczyść, żeby wrócić do PIN-u głównego.',
    'panel.account': 'Konto na radiodyplom.pl',
    'account.operator': 'Operator',
    'account.stations': 'Stacje, na które wolno logować',
    'account.actions': 'Aktywne akcje',
    'account.pinExpires': 'PIN wygasa',
    'account.apiDisabled': 'To konto ma wyłączone API — nic się nie zapisze.',
    'account.notReported': 'serwis nie podaje (starsza wersja API)',
    'account.noStations': 'brak — konto nie ma przypisanej żadnej stacji',
    'account.noActions': 'brak — w tej chwili nie ma do czego zapisywać',
    'account.unknown': 'Jeszcze nie sprawdzono.',
    'account.offline': 'Brak łączności z serwisem — dane konta nieznane.',
    'chk.ok': 'Konto {konto} ma tę stację na liście. Kopie się zapiszą.',
    'chk.noActiveAction': 'Uprawnienia są, ale konto {konto} nie ma teraz aktywnej akcji '
      + 'dyplomowej. QSO wysłane dziś nigdzie nie trafi.',
    'chk.missingStation': 'Konto {konto} NIE ma stacji {stacja} na liście uprawnień. '
      + 'Te kopie wrócą jako odrzucone. Dopisz stację w Managerze na radiodyplom.pl.',
    'chk.badPin': 'Serwis odrzucił PIN tego celu. Kopie nie pójdą.',
    'chk.apiDisabled': 'Konto {konto} ma wyłączone API. Kopie nie pójdą.',
    'chk.noPin': 'Brak PIN-u — ani przy tym celu, ani głównego.',
    'confirm.targetsRejected': 'Serwis nie przyjmie kopii dla: {stacje}.\n\nTe konta nie '
      + 'mają tych znaków na liście stacji, więc QSO wrócą jako odrzucone.\n\nZapisać '
      + 'mimo to? (jeśli właśnie dopisujesz stację w Managerze — zapisz, sprawdzenie '
      + 'odświeży się samo)',
    'confirm.dropTargetPin': 'Usunąć własny PIN z celów: {stacje}?\n\nTe kopie polecą '
      + 'wtedy PIN-em głównym, a jeśli te stacje nie są przypisane do Twojego konta, '
      + 'wrócą jako odrzucone.\n\nSekretu nie da się odczytać z okna, więc trzeba go '
      + 'będzie wpisać na nowo.',
    'hint.targetIncomplete': 'NIE ZAPISANO — każda pozycja wymaga znaku stacji.',
    'hint.fanout': 'Puste = jedno QSO ze znakiem stacji z loggera. Każdy znak stacji musi '
      + 'być na liście stacji Twojego konta w Managerze — inaczej serwer nie zapisze kopii.',
    'hint.requeue': '„Ponów odrzucone" wraca do kolejki WSZYSTKIE odrzucone — także te, '
      + 'które serwer odrzucił wcześniej. Ma to sens po poprawieniu uprawnień '
      + 'w Managerze; QSO naprawdę błędne wrócą tu z tym samym błędem.',
    'confirm.requeueDryRun': 'TRYB PRÓBNY JEST WŁĄCZONY.\n\nPrzywrócone QSO przejdą '
      + 'próbnie, czyli NIE zostaną wysłane na serwer — i znikną z kolejki '
      + 'na dobre.\n\nJeśli chcesz je naprawdę wysłać, najpierw wyłącz tryb '
      + 'próbny w Konfiguracji.\n\nPonowić mimo to?',
    'hint.requeued': 'Przywrócono do kolejki QSO:',
    'hint.requeuedNone': 'Nie było czego przywracać.',
    'hint.acked': 'Wyczyszczono sygnalizację. Niepotwierdzonych było:',
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
    'btn.discardFailed': 'Usuń odrzucone QSO',
    'confirm.discardFailed': 'Trwale usunąć {n} odrzuconych QSO?\n\nTEGO NIE DA SIĘ '
      + 'ODWRÓCIĆ. Jeśli chcesz je jeszcze wysłać — na przykład po poprawieniu '
      + 'konfiguracji — użyj „Ponów odrzucone".\n\nKażde usunięte QSO zostanie '
      + 'wypisane w pliku logu.',
    'hint.discarded': 'Usunięto trwale QSO:',
    'panel.view': 'Widok',
    'label.recentEvents': 'Ile ostatnich zdarzeń pokazywać',
    'hint.recentEvents': 'Od 5 do 200. Dotyczy panelu „Ostatnie zdarzenia" na zakładce Stan.',
    'sub.sentSession': 'w tej sesji: {n} kopii',
    'sub.sentDuplicates': ' · duplikatów: {n}',
    'sub.sentDry': ' · próbnie (nie wysłane): {n}',
    'sub.onDisk': 'na dysku, przeżywa restart',
    'sub.datagrams': 'datagramów: {r} · nieodczytane: {n}',
    'sub.session': 'w tej sesji',
    'tip.sent': 'Licznik OD POCZĄTKU — przeżywa restart programu. Liczy KOPIE, '
      + 'nie QSO: jedno QSO rozmnożone na trzy stacje to trzy kopie. Przejścia '
      + 'próbne mają osobny licznik i tu się NIE wliczają.',
    'tip.pending': 'QSO czekające na wysyłkę. Leżą na dysku, więc przeżywają restart '
      + 'i zamknięcie programu.',
    'tip.failed': 'Kopie odrzucone przez serwis. Leżą na dysku; można je ponowić '
      + 'albo usunąć w zakładce Kolejka.',
    'tip.received': 'QSO przyjęte z loggerów W TEJ SESJI — zeruje się przy restarcie. '
      + 'W drugiej linii: wszystkie datagramy oraz te, z których QSO nie powstało '
      + '(nieznany format, brak wymaganych pól albo świadome pominięcie, '
      + 'np. edycja QSO w loggerze).',
    'tip.skipped': 'Kopie pominięte przez deduplikację, bo poszły już wcześniej. '
      + 'Licznik tej sesji.',
    'tip.sentDryTotal': 'Próbnie od początku: {n}.',
    'sources.notDecoded': 'bez QSO: {n}',
    'sources.ndUnknown': 'nieznany format: {n}',
    'sources.ndInvalid': 'brak wymaganych pól: {n}',
    'sources.ndSkipped': 'pominięte świadomie: {n}',
    'hint.dryRun': 'Nic nie leci na serwer. Uwaga: QSO przepuszczone próbnie zostaje '
      + 'zamknięte w deduplikacji i NIE poleci po wyłączeniu trybu próbnego. '
      + 'Jeśli chcesz tylko przytrzymać QSO na później, użyj „Wstrzymaj”.',
    'badge.problems': 'PROBLEMY:',
    'hint.problemBadge': 'Kliknij, aby przejść do zakładki Kolejka — tam są odrzucone QSO '
      + 'i przyciski: ponowienie, wyczyszczenie sygnalizacji, usunięcie.',
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
    'tab.stats': 'Statistics',
    'panel.statsRange': 'Range',
    'range.today': 'Today',
    'range.week': '7 days',
    'range.month': '30 days',
    'range.all': 'All',
    'stats.empty': 'The journal is empty. It fills up with every QSO sent; history '
      + 'from before 0.1.10 can be imported from the logs with the import-log tool.',
    'stats.qso': 'QSOs',
    'stats.copies': 'Copies',
    'stats.qsoShort': 'QSO',
    'stats.copiesShort': 'copies',
    'stats.days': 'Days on air',
    'stats.perDayAvg': '{n} QSOs per day on average',
    'stats.first': 'First QSO',
    'stats.last': 'Last',
    'stats.perDay': 'By day',
    'stats.perAction': 'By award',
    'stats.perOperator': 'By operator',
    'stats.perStation': 'By station',
    'stats.perBand': 'By band',
    'stats.perMode': 'By mode',
    'stats.perSource': 'By logger',
    'stats.topCalls': 'Most worked',
    'stats.calls': 'Unique callsigns',
    'stats.stationsCount': 'from {n} stations',
    'tip.statsCalls': 'How many DIFFERENT callsigns were worked. The “most worked” '
      + 'list shows only the top of it.',
    'stats.more': '… and {n} more',
    'tip.statsQso': 'The number of CONTACTS. Copies are the same contact sent under '
      + 'several station callsigns — one QSO to three stations is three copies.',
    'tip.statsDays': 'Days with at least one QSO. The average is over those days, not '
      + 'over the length of the range — otherwise a week with a single Saturday on air '
      + 'would look like a disaster.',
    'tab.log': 'Log',

    'btn.pause': 'Pause',
    'btn.resume': 'Resume',
    'btn.requeue': 'Retry rejected',
    'btn.save': 'Save',
    'btn.addTarget': 'Add station',
    'btn.remove': 'Remove',
    'btn.confirmYes': 'Yes',
    'btn.confirmNo': 'Cancel',
    'btn.quit': 'Quit',
    'btn.openLog': 'Show log file',
    'btn.logEnd': 'To the end',
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
    'label.targetOn': 'Active',
    'label.stationCall': 'Station callsign',
    'label.operator': 'Operator (optional)',
    'label.targetPin': 'Account PIN (optional)',
    'label.language': 'Interface language',

    'hint.pin': 'Leave it masked to keep the current PIN. Type a new one to replace it.',
    'hint.multicast': 'empty = none',
    'hint.logFollowing': 'following the log',
    'hint.logPaused': 'scrolled up — new entries keep arriving at the bottom',
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
    'hint.targetOn': 'Uncheck to switch this rule off without deleting its data.',
    'hint.targetPin': 'empty = main PIN',
    'hint.targetPinLong': 'PIN of the account this copy is sent from. Needed only when '
      + 'that station is NOT assigned to your own account. Leave it masked to keep it; '
      + 'clear it to fall back to the main PIN.',
    'panel.account': 'radiodyplom.pl account',
    'account.operator': 'Operator',
    'account.stations': 'Stations allowed to log',
    'account.actions': 'Active awards',
    'account.pinExpires': 'PIN expires',
    'account.apiDisabled': 'This account has the API disabled — nothing will be saved.',
    'account.notReported': 'not reported by the service (older API)',
    'account.noStations': 'none — the account has no station assigned',
    'account.noActions': 'none — there is nothing to save into right now',
    'account.unknown': 'Not checked yet.',
    'account.offline': 'No connection to the service — account details unknown.',
    'chk.ok': 'Account {konto} has this station listed. Copies will be saved.',
    'chk.noActiveAction': 'Rights are fine, but account {konto} has no active award '
      + 'right now. A QSO sent today would not be saved anywhere.',
    'chk.missingStation': 'Account {konto} does NOT have station {stacja} in its rights. '
      + 'Those copies will come back rejected. Add the station in the radiodyplom.pl Manager.',
    'chk.badPin': 'The service rejected this target PIN. Copies will not be sent.',
    'chk.apiDisabled': 'Account {konto} has the API disabled. Copies will not be sent.',
    'chk.noPin': 'No PIN — neither on this target nor the main one.',
    'confirm.targetsRejected': 'The service will not accept copies for: {stacje}.\n\nThose '
      + 'accounts do not have these callsigns in their station list, so the QSOs will come '
      + 'back rejected.\n\nSave anyway? (if you are adding the station in the Manager right '
      + 'now — save, the check refreshes itself)',
    'confirm.dropTargetPin': 'Remove the own PIN from: {stacje}?\n\nThose copies will then '
      + 'be sent with the main PIN, and if those stations are not assigned to your '
      + 'account they will come back rejected.\n\nThe secret cannot be read back from '
      + 'the window, so you would have to type it again.',
    'hint.targetIncomplete': 'NOT SAVED — every row needs a station callsign.',
    'hint.fanout': 'Empty = one QSO with the station callsign from the logger. Every station '
      + 'callsign must be on your account\'s station list in the Manager — otherwise the '
      + 'server will not store that copy.',
    'hint.requeue': '“Retry rejected” puts ALL rejected QSOs back in the queue, including '
      + 'those the server refused earlier. That makes sense after fixing permissions '
      + 'in the Manager; genuinely bad QSOs will come back with the same error.',
    'confirm.requeueDryRun': 'DRY RUN IS ON.\n\nThe restored QSOs will pass through '
      + 'as a dry run — they will NOT be sent to the server, and they will be '
      + 'gone from the queue for good.\n\nTo actually send them, turn dry run '
      + 'off in Configuration first.\n\nRetry anyway?',
    'hint.requeued': 'QSOs put back in the queue:',
    'hint.requeuedNone': 'Nothing to put back.',
    'hint.acked': 'Indicator cleared. Unacknowledged count was:',
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
    'btn.discardFailed': 'Delete rejected QSOs',
    'confirm.discardFailed': 'Permanently delete {n} rejected QSOs?\n\nTHIS CANNOT BE '
      + 'UNDONE. If you still want to send them — for instance after fixing the '
      + 'configuration — use “Retry rejected”.\n\nEvery deleted QSO is written '
      + 'to the log file.',
    'hint.discarded': 'QSOs permanently deleted:',
    'panel.view': 'View',
    'label.recentEvents': 'How many recent events to show',
    'hint.recentEvents': 'Between 5 and 200. Applies to the “Recent events” panel on the Status tab.',
    'sub.sentSession': 'this session: {n} copies',
    'sub.sentDuplicates': ' · duplicates: {n}',
    'sub.sentDry': ' · dry run (not sent): {n}',
    'sub.onDisk': 'on disk, survives a restart',
    'sub.datagrams': 'datagrams: {r} · not decoded: {n}',
    'sub.session': 'this session',
    'tip.sent': 'Counter SINCE THE BEGINNING — it survives a restart. It counts COPIES, '
      + 'not QSOs: one QSO fanned out to three stations is three copies. Dry-run '
      + 'passes have their own counter and are NOT included here.',
    'tip.pending': 'QSOs waiting to be sent. They live on disk, so they survive '
      + 'a restart and closing the program.',
    'tip.failed': 'Copies rejected by the service. They live on disk; you can requeue '
      + 'or discard them on the Queue tab.',
    'tip.received': 'QSOs accepted from loggers THIS SESSION — it resets on restart. '
      + 'Second line: all datagrams and those that produced no QSO (unknown format, '
      + 'missing required fields, or a deliberate skip such as editing a QSO in '
      + 'the logger).',
    'tip.skipped': 'Copies skipped by deduplication because they were already sent. '
      + 'Counter for this session.',
    'tip.sentDryTotal': 'Dry-run passes since the beginning: {n}.',
    'sources.notDecoded': 'no QSO: {n}',
    'sources.ndUnknown': 'unknown format: {n}',
    'sources.ndInvalid': 'missing required fields: {n}',
    'sources.ndSkipped': 'deliberately skipped: {n}',
    'hint.dryRun': 'Nothing is sent to the server. Note: a QSO passed through in dry run '
      + 'is marked as handled and will NOT be sent after you turn dry run off. '
      + 'To merely hold QSOs for later, use “Pause”.',
    'badge.problems': 'PROBLEMS:',
    'hint.problemBadge': 'Click to open the Queue tab — the rejected QSOs are there, with '
      + 'buttons to retry, clear the indicator, or delete them.',
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
