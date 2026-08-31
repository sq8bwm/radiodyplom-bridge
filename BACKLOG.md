# Backlog

Stan na 2026-08-31. Pozycje uporządkowane wg tego, co blokuje wydanie.

## Blokujące wydanie

### Test na prawdziwym Windows — częściowo zrobiony
Wersja instalacyjna przetestowana na Windows (2026-08-31). **Potwierdzone działa:**
instalator, zasiewanie konfiguracji w `%APPDATA%`, zapis i trwałość PIN-u,
przycisk „Zakończ", menu pod ikoną w zasobniku.

**Nadal niesprawdzone na Windows** — wymaga dostępu do maszyny z loggerem:
- odbiór **rozgłoszeniowy z N1MM** (najbardziej prawdopodobna przyczyna „nie działa" —
  N1MM często nadaje na adres rozgłoszeniowy, nie na localhost, więc trzeba
  `udp.host: 0.0.0.0`),
- pytanie **zapory Windows** przy pierwszym bindzie UDP,
- praca w tle po zamknięciu okna przez dłuższy czas,
- autostart (nadal niezaimplementowany, patrz niżej).

### KRYTYCZNE: deduplikacja po cichu gubi prawdziwe QSO
Zgłoszone z Windows 2026-08-31, wersja 0.1.2. Zdiagnozowane z logu operatora.

**Objawy:** QSO o 20:35 (SP4OIK) poszło tylko na **jeden z trzech** celów; QSO
o ~20:37 (SP7VCL) **nie pojawiło się nigdzie** — ani w logu, ani w kolejce, ani
w odrzuconych. Obie łączności przeszły dopiero po **ponownym zalogowaniu w QLog**
(ok. 20:47), już na wszystkie trzy cele.

**Przyczyna.** Klucz deduplikacji to `qlog:{logid}#{rowid}|{stacja}`, gdzie `rowid`
pochodzi z bazy QLog. To identyfikator wiersza SQLite, a taki **jest ponownie
używany po skasowaniu rekordu**. Operator kasował w QLog testowe QSO, więc nowe
łączności dostawały `rowid` już zapisany w `seen` — i były odrzucane jako duplikaty.

Dane z `seen.json` to potwierdzają: 141 kluczy, 47 różnych `rowid` w ciągłym
zakresie 54287–54333, **bez ani jednej luki**, po dokładnie 3 klucze na `rowid`.
Przez wieczór zalogowano więcej niż 47 QSO, więc numery musiały się powtarzać.

To wyjaśnia oba objawy:
- SP7VCL: wszystkie trzy klucze już były w `seen` → **cisza absolutna**, bo wpis
  „Nowe QSO" powstaje tylko przy udanym dodaniu do kolejki,
- SP4OIK: dwa klucze były (z wcześniejszej konfiguracji o dwóch celach), trzeci
  nowy → jedna kopia.

**To najgroźniejsza usterka w projekcie**: prawdziwe QSO znika bez śladu.

Do zrobienia:
1. **Klucz deduplikacji nie może opierać się wyłącznie na `rowid`.** Dołożyć treść
   QSO (znak + data + czas + pasmo + emisja + stacja), tak jak już robi dekoder
   WSJT-X, który nie ma identyfikatora i liczy skrót syntetyczny. Rozważyć
   syntetyczny klucz dla wszystkich dekoderów, a `rowid` traktować najwyżej jako
   dodatek.
2. **Pominięcie deduplikacyjne musi być widoczne.** Dziś leci na poziomie `debug`,
   więc przy zwykłych ustawieniach nie widać go wcale. Podnieść do `info`, a przy
   fan-oucie zalogować, ile kopii pominięto i dlaczego.
3. Rozważyć wygasanie wpisów w `seen` (np. po dobie) — lista rośnie bez końca,
   a kolizje starych kluczy tylko zyskują na prawdopodobieństwie.
4. Test regresyjny: ten sam `rowid` z **innym** QSO musi przejść.

### Zapisywanie logu do pliku
Dziś log żyje wyłącznie w pamięci (bufor 300 wpisów) i ginie przy zamknięciu.
Uniemożliwia to diagnozę czegokolwiek po fakcie — co właśnie boleśnie wyszło
przy zgłoszeniu powyżej.

Do zrobienia: zapis do pliku w katalogu danych, z rotacją (żeby nie rósł
w nieskończoność), poziom konfigurowalny, oraz przycisk „otwórz katalog z logiem"
w interfejsie. Warto rozważyć osobny zapis zdarzeń QSO (kto, kiedy, dokąd,
z jakim wynikiem) — przydatny nie tylko do diagnozy, ale i jako ślad dla operatora.

## Świadomie odłożone

### Podpis kodu dla Windows — nie podpisujemy
**Decyzja (2026-08-31): nie kupujemy certyfikatu.** Instalator zostaje niepodpisany,
Windows pokaże SmartScreen („Nieznany wydawca").

Ustalenia z rozeznania cen, żeby nie robić tego drugi raz:

- **EV przestał dawać to, za co się płaciło.** Od marca 2024 Microsoft zrównał EV i OV —
  oba budują reputację SmartScreena **wyłącznie liczbą pobrań**. Natychmiastowy brak
  ostrzeżenia przy EV już nie istnieje. EV zostaje obowiązkowy tylko dla sterowników
  kernel-mode.
- Dla narzędzia niszowego to rozstrzygające: przy kilkudziesięciu pobraniach reputacja
  nie zbuduje się szybko **przy żadnym certyfikacie**.

| Opcja | Koszt | Uwagi |
|---|---|---|
| Azure Artifact Signing (dawniej Trusted Signing) | ~$9,99/mies. (~$120/rok) | do 5000 podpisów; **osoby prywatne tylko USA/Kanada**, organizacje USA/Kanada/UE/UK |
| OV tanio | od ~$65/rok | wymaga tokenu HSM albo podpisywania w chmurze |
| OV typowo | ~$219–400/rok | Sectigo/Comodo od $219, DigiCert $400 |
| EV | ~$280–685/rok | bez sensu po zmianie z 2024 |

Koszty ukryte: od czerwca 2023 klucz prywatny **musi** być na tokenie sprzętowym FIPS
albo w chmurowym HSM; od marca 2026 maksymalna ważność certyfikatu to 460 dni.

Gdyby decyzja miała się zmienić: najtańsza sensowna droga to **Azure Artifact Signing
przez organizację z UE** (jako osoba prywatna z Polski nie ma kwalifikacji). Uwaga na
zgłaszany haczyk: przypisanie roli może wymagać licencji Entra ID P2, czyli dopłaty.

Co robimy zamiast podpisu (tanie i skuteczniejsze przy tej skali):
- publikować **sumy kontrolne** artefaktów — **zrobione**, `release/SHA256SUMS`
  generowane przy każdym pakowaniu, format zgodny z `sha256sum -c`,
- dawać wersję **przenośną** obok instalatora,
- opisać w instrukcji kliknięcie „Więcej informacji → Uruchom mimo to",
- dla Linuksa problem nie występuje (AppImage, `.deb`).

### Rozstrzyganie `PHONE` po bandplanie — nie robimy
**Decyzja (2026-08-31): nie wchodzimy w to.** `PHONE` przechodzi surowe.

Powód, żeby nie wracać: na 2 m i 70 cm fonia bywa i FM, i SSB, więc odwzorowanie
po paśmie myliłoby się w obie strony, a emisja wpływa na punktację akcji. Lepszy
jest surowy `PHONE` widoczny w logu niż elegancko zgadnięta zła wartość.
Gdyby jakiś logger faktycznie zaczął nadawać `PHONE` masowo — mamy `freq`
w każdym dekoderze, więc bandplan IARU R1 jest wtedy do zrobienia.

### Pole „Klucz: (COMMENT)" — zostaje jak jest
**Decyzja (2026-08-31): nie wnikamy.** Przekazujemy surowy komentarz z loggera
do pola `comment` i tak zostaje.

Kontekst, żeby nie badać tego od zera, gdyby wróciło: formularz w Managerze
podpisuje to pole jako **„Klucz"**, co sugeruje, że może mieć znaczenie
rozliczeniowe (dopasowanie do warunków akcji), a nie być zwykłą notatką.
Nie zostało to potwierdzone i nie da się rozstrzygnąć testem — potrzebna
informacja od autora serwisu.

Gdyby okazało się, że pole ma znaczenie: przestać je wysyłać albo wypełniać
wartością z konfiguracji, zamiast tekstem od operatora.

## Funkcjonalne

### Kolejne dekodery loggerów
Obsłużone: QLog, N1MM/DXLog/BBlogger/Log4OM, WSJT-X/JTDX/MSHV.
Nieobsłużone (własne protokoły, **specyfikacji nie weryfikowałam**):
QARTest (9458), Swisslog (2333), Win-Test (9871), Ham Radio Deluxe, WriteLog, LogHX.
Dodanie = jeden plik w `src/decoders/` (`name`, `detect`, `decode`) + wpis do rejestru.
Reszta pipeline'u bez zmian.

### Zamykanie Electrona sygnałem — niepotwierdzone
`ui/main.js` ma teraz `tray.destroy()` na ścieżkach wyjścia i handlery
`SIGTERM`/`SIGINT`/`SIGHUP`, ale **nie udało się potwierdzić, że handlery faktycznie
się wykonują**: Electron na Linuksie przeładowuje proces (zmiana PID), a Chromium
instaluje własną obsługę sygnałów, która może omijać handlery Node.

Objaw przy braku poprawnego zamknięcia: ikona w zasobniku nie jest wyrejestrowana
i panel (u nas XFCE, wtyczka „Obszar powiadomień") pokazuje ostrzeżenie, że wtyczka
nieoczekiwanie zniknęła. Przy kilkunastu takich zgonach panel zaczyna protestować.

Pewna ścieżka: „Zakończ" w menu ikony (`shutdown()` → `tray.destroy()` → `app.quit()`).

**Do domknięcia razem z autostartem** — usługa startująca z systemem będzie zamykana
właśnie sygnałem, więc to nie jest kwestia teoretyczna. Do sprawdzenia:
`app.on('will-quit')`, `powerMonitor`, ewentualnie proces nadzorujący, który woła
`app.quit()` przez IPC zamiast wysyłać sygnał.

Na czas testów jest `RD_NO_TRAY=1` (start bez ikony). Uwaga: zmienna musi dotrzeć
do samego procesu Electrona — przy `xvfb-run` potrafi się zgubić.

### Autostart
Opisany w README (Harmonogram zadań / systemd), ale **nie zaimplementowany** —
brak opcji w instalatorze i brak `app.setLoginItemSettings()`. Dla usługi w tle
to naturalne oczekiwanie użytkownika.

### Aktualizacje aplikacji
Brak mechanizmu (`electron-updater`). Przy dystrybucji do innych osób oznacza to,
że każdą poprawkę trzeba rozesłać ręcznie.

## Techniczne / jakościowe

### Okno automatycznego ponawiania
Domyślnie ~3,4 h (5 s → 15 min, 20 prób). Po wyczerpaniu QSO idzie do `data/failed/`
i wymaga jednego kliknięcia „Ponów odrzucone". Rozważyć wyższe `maxAttempts`
domyślnie albo automatyczne ponawianie z `failed/` po powrocie łączności.

## Zamknięte (dla pamięci — potwierdzone testem)

- `time_on` w formacie `HHMMSS` jest przyjmowany i zapisywany co do sekundy.
- `station_callsign` i `operator` to niezależne pola; fan-out je poprawnie rozdziela.
- Fan-out na dwie stacje: oba QSO **punktowane** (reguła duplikatu obejmuje stację).
- PIN jest per profil użytkownika; wysyłka w imieniu innej stacji wymaga jej PIN-u.
- Duplikaty są zapisywane i oznaczane jako niepunktowane, nie odrzucane.
- Automatyczne dosyłanie po awarii łączności działa bez ingerencji.
- Sekrety nie trafiają do paczek (sprawdzone przez rozpakowanie `app.asar`).
- Dwie instancje nie zajmą jednego portu UDP ani jednego katalogu danych.
- Przełączalny język PL/EN — słownik `ui/strings.js`, wybór zapamiętywany,
  błędy API tłumaczone po kodzie. Zweryfikowane zrzutami w obu językach.
- Cel `.deb` włączony (opiekun: `author` z `package.json`).
- Menu pod ikoną w zasobniku na Windows: przyczyną było przebudowywanie menu
  co 3 s (`setContextMenu` w pętli odświeżania). Po ograniczeniu do zmian
  etykiet menu działa — potwierdzone na Windows.
- Zamykanie programu: przycisk „Zakończ" w oknie, niezależny od zasobnika.
  Potwierdzony na Windows i na Linuksie.
- Testowe QSO z prób (`SP0*`, akcja 295) — usunięte przez operatora w Managerze.
- Testy automatyczne: **99 testów** na `node:test`, bez zależności (`npm test`).
  Każdy dzisiejszy błąd ma swój test regresyjny. Skuteczność sprawdzona mutacjami:
  cofnięcie trzech poprawek (pasmo wielkimi literami, `savedTo:[]` jako sukces,
  klucz kopii bez znaku stacji) za każdym razem wywala właściwy test.
