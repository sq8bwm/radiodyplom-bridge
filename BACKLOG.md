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

## Świadomie odłożone

### PIN SQ8BWA w starych obiektach na GitHubie — do unieważnienia, nie do wyczyszczenia
**Stan na 2026-09-02.** W commitach `6d72e1e` i `8758492` znalazły się przypadkiem
dwa pliki wymiany vima (`.20260831*.log.swp`) zapisane razem z logiem konsoli.
Zawierały **PIN API konta SQ8BWA**. Plików nie ma w drzewie roboczym od `8758492`,
a historia została **przepisana** (`git filter-branch`) i wymuszenie wypchnięta —
gałąź `main` jest czysta, zero obiektów `.swp`.

**Ale**: GitHub nadal oddaje stare commity i ten blob **po SHA** (sprawdzone:
pobrałam blob i PIN w nim jest). Wymuszone wypchnięcie nie odśmieca magazynu.

**Decyzja: nie czyścimy dalej.** Repozytorium jest prywatne, zero forków, zero
obserwujących. Gwarantowałoby to tylko skasowanie i odtworzenie repozytorium albo
zgłoszenie do GitHub Support — obie drogi kosztują więcej, niż są tu warte.

**Prawdziwa naprawa, niezależna od historii: WYGENEROWAĆ NOWY PIN dla SQ8BWA**
(Manager → Dostęp API → Generuj nowy PIN API) i podmienić go w konfiguracji.
Po tym stary PIN jest bezwartościowy i cała sprawa jest zamknięta.

Wniosek na przyszłość: `.gitignore` ma już `*.swp`, ale sedno jest inne — **nie
commitować surowych logów pracy**. Log konsoli mostka może zawierać PIN-y celów
fan-outu, bo widać w nim ładunki żądań.


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
Opisany w `docs/windows-i-siec.md` (Harmonogram zadań / systemd), ale **nie zaimplementowany** —
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
- **„Ponów odrzucone" w trybie próbnym po cichu wyrzucało QSO** — przechodziły
  „na sucho", nie leciały na serwer, a mimo to znikały z kolejki i wracały do
  deduplikacji. Czyli przycisk, którym się ratuje łączności, kasował je.
  Zauważone przez operatora po zobaczeniu wierszy „próbnie — NIE wysłane"
  („czy to ok?"). Teraz przy włączonym trybie próbnym program pyta wprost,
  zanim cokolwiek ruszy.
- **„Ponów odrzucone" nic nie robiło** — pomijało QSO odrzucone przez serwer,
  bo są w zbiorze deduplikacji, i milczało o tym. Zgłoszone jako „nie reaguje
  na kliknięcie". Teraz przywraca WSZYSTKO, uwalniając klucze (trwale, bo
  restart przywróciłby blokadę), i mówi, ile wróciło albo że nie było czego.
  Sens: NOT_SAVED z powodu znaku poza listą konta przestaje być prawdą po
  poprawieniu uprawnień w Managerze. Dwa testy z odwróconą regułą, jeden
  na trwałość uwolnienia klucza.
- **Trzy przyciski odrzuconych w jednym miejscu** (zakładka Kolejka): ponowienie,
  wyczyszczenie sygnalizacji, usunięcie. „Ponów odrzucone" zeszło z nagłówka —
  tam zostały tylko język, „Wstrzymaj" i „Zakończ". Plakietka „PROBLEMY" znów
  tylko przenosi na Kolejkę: w nagłówku obok stoi „Zakończ", więc nie może tam
  być akcji działającej od jednego kliknięcia. Komunikat o wyniku akcji gaśnie
  po 12 s, żeby po czasie nie wprowadzał w błąd.
- **„Zakończ" lądował pod plakietkami w nagłówku** przy wąskim oknie i dało się
  go trafić, celując w plakietkę problemów — co realnie się stało przy próbach.
  Przyciski nagłówka są teraz jedną grupą (zawijają się razem, nie pojedynczo)
  i po zawinięciu trzymają się prawej krawędzi, a „Zakończ" jest odcięty
  separatorem. Sprawdzone zrzutami przy 920 i 1200 px.
- **Usuwanie odrzuconych QSO** — przycisk w panelu Odrzucone, na wypadek gdy są
  to łączności błędne i nie ma czego ratować. Jedyna akcja w programie, która
  trwale niszczy dane, więc: potwierdzenie z liczbą i zdaniem „TEGO NIE DA SIĘ
  ODWRÓCIĆ", a **każde usunięte QSO wypisane w pliku logu** (znak, stacja, kod,
  klucz). Po usunięciu poziom potwierdzenia zjeżdża do zera, więc następne
  odrzucenie znów zapala plakietkę. Sprawdzone w oknie, z zatwierdzeniem
  okienka: 4 QSO zniknęły, w logu został pełny ślad.
- **Tryb próbny podpisywał QSO jako „wysłane"** — bez numeru akcji, choć nic nie
  opuszczało komputera. Zauważone przez operatora na liście zdarzeń („dlaczego
  trzy ostatnie nie mają numeru akcji?"). Teraz osobny rodzaj zdarzenia
  („próbnie — NIE wysłane", żółty) i etykieta licznika „Wysłane (próbnie)".
  Przy okazji podpisana pułapka: QSO przepuszczone próbnie zostaje zamknięte
  w deduplikacji i NIE poleci po wyłączeniu trybu — do przytrzymania QSO służy
  „Wstrzymaj". Podpowiedź na plakietce DRY-RUN i sekcja w docs/interfejs.md.
- **Lista ostatnich zdarzeń** zamiast dwóch pojedynczych linii: bufor 200 zdarzeń
  w rdzeniu, liczba wierszy z konfiguracji (`ui.recentEvents`, 5–200, domyślnie 20,
  przycinana po obu stronach). Wiersze z problemem czerwone, ponowienia żółte,
  duplikaty wyblakłe.
- **Sygnalizacja problemów** — plakietka „PROBLEMY: n" obok DRY-RUN, gdy są
  odrzucone QSO, których użytkownik jeszcze nie potwierdził. Wynika z RÓŻNICY
  między zawartością `data/failed/` i trwale zapisanym `ackedFailed`
  w `seen.json`, więc przeżywa restart. Kasowanie kliknięciem plakietki
  (z potwierdzeniem) albo przyciskiem w panelu Odrzucone; kasuje samą
  sygnalizację, QSO zostają. 10 testów.
- **Pierwsza wersja sygnalizacji trzymała licznik w pamięci workera** — i to był
  błąd wprost przeciwny jej celowi: w spakowanej aplikacji rdzeń żyje w tym samym
  procesie co okno, więc zamknięcie programu kasowało ostrzeżenie, choć odrzucone
  QSO zostawały na dysku. Zgłoszone przez operatora: „w dymku jest 4 odrzucone
  QSO, a nie ma odrzuconych; nie da się na to kliknąć i zresetować". Przy okazji
  domknięta pułapka arytmetyki: po „Ponów odrzucone" poziom potwierdzenia musi
  zostać przycięty w dół, inaczej następne odrzucenie byłoby przemilczane.
- **Trasy lokalnego API nie miały testów** — `/api/problems/ack` rzucała
  „json is not defined" i cały zestaw przeszedł, bo żaden test nie dotykał
  warstwy HTTP. Doszło 8 testów przechodzących po wszystkich trasach.
- **Zakładka „O programie"** — wersja, autor, licencja i zdanie o braku gwarancji,
  plus odnośniki do licencji, repozytorium i wydań. Nic nie jest wpisane na sztywno:
  dane idą z `package.json` przez `/api/status`, więc wersja w oknie nie może
  rozjechać się z nazwą instalatora. Odnośniki otwiera przeglądarka systemowa,
  a uchwyt IPC przepuszcza wyłącznie `https://`.
- **Nagłówki licencyjne** w 42 plikach źródłowych, w formie SPDX (dwie linie,
  czytelne dla ludzi i dla narzędzi). Shebang i `<!doctype>` zostały pierwsze.
- **Zdublowany klucz w słowniku UI** — przy dodawaniu zakładki ten sam klucz
  trafił dwa razy do bloku polskiego (linia `'tab.log': 'Log',` jest w obu
  językach identyczna), więc polski interfejs pokazywał angielską etykietę.
  Bezgłośnie: w obiekcie JS wygrywa ostatni wpis. Widać to było dopiero na
  zrzucie ekranu. Doszło 7 testów słownika czytających plik jako TEKST —
  po sparsowaniu obiektu duplikatu nie da się zauważyć.
- **Model uprawnień radiodyplom — zmierzony 2026-09-02, poprzedni wniosek był zły.**
  PIN to konto, a konto ma w Managerze listę znaków stacji, na które wolno mu
  logować. Serwer sprawdza `station_callsign`; pola `operator` **nie sprawdza
  wcale** (przechodzi nawet znak nieistniejący). Wcześniejsze „N stacji wymaga
  N PIN-ów" wynikało z jednego pomiaru, w którym stacji po prostu nie było na
  liście konta. **Jeden PIN wystarcza.** Pomiar i tabela w `docs/konfiguracja.md`.
  Kosztowało to 7 testowych QSO w akcji 295 — w tym 5 przez błąd w sondzie,
  która miała nie zapisywać nic (`band` wymaga nasz mapper, nie API).
  Wszystkie usunięte przez operatora w Managerze (2026-09-02).
- **Baza operatorów: zbudowana i usunięta.** Powstała pod błędny model
  (osobne PIN-y per operator), z lokalnym odrzucaniem QSO operatorów spoza
  bazy. Pomiar pokazał, że takie QSO serwer normalnie przyjmuje, więc kod
  odrzucał poprawne łączności — usunięty w całości. Zostały z tego trzy
  rzeczy niezależne od modelu: wielkie litery w polach znaku, licznik
  „wysłane" i zapis konfiguracji bez wycinania nieznanych sekcji.
- **Licznik „wysłane" zawyżał** — był rozmiarem zbioru deduplikacji, a ten
  obejmuje też trwałe odrzucenia, więc rósł przy każdym odrzuceniu i sugerował,
  że QSO doszło. Teraz osobny licznik w `seen.json` (format `{seen, sent}`,
  starsza tablica nadal wczytywana bez utraty statystyki).
- **Zapis z UI gubił sekcje, których nie zna** — `writeConfigFile` budował plik od
  zera z ustalonej listy kluczy, więc każdy zapis wycinał `logFile`
  i `radiodyplom.pingIntervalMs`. Teraz nadpisuje tylko to, czym zarządza
  interfejs. Dwa testy regresyjne.
- **Brak pozycji w menu po instalacji `.deb`** — naprawione w 0.1.4. Przyczyną było
  `Categories=HamRadio;`: wg specyfikacji freedesktop to kategoria dodatkowa i sama
  nie wpina wpisu do żadnej gałęzi. Rozstrzygnięcie plików menu potwierdziło:
  przed poprawką XFCE → tylko kosz „Inne", GNOME → nigdzie; po `Network;HamRadio;`
  XFCE → Sieć, GNOME → Internet. Przy okazji `StartupWMClass` zgadza się teraz
  z faktycznym `WM_CLASS` okna (zmierzone), więc środowisko kojarzy działające
  okno z pozycją w menu. 5 testów pilnujących konfiguracji pakowania.
- **Ciche gubienie QSO przez kolizję `rowid`** — naprawione w 0.1.3. Klucz łączy
  identyfikator loggera z odciskiem treści, więc odzyskany `rowid` nie kasuje
  nowego QSO, a przelogowanie tej samej łączności nadal przechodzi.
  Pominięcia są widoczne w logu i liczone. 7 testów regresyjnych.
- **Zapis logu do pliku** z rotacją, synchroniczny (ostatnie linie nie giną przy
  wyjściu), plus przycisk „Pokaż plik logu" w UI i w menu zasobnika.
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
