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

### Przepisanie historii commitów — NIE robimy
**Decyzja (2026-09-03).** Historia zostaje jaka jest, z widocznym okresem ISC.
Nie dopisujemy też noty o zmianie licencji do README.

Powód, żeby nie wracać: przepisanie commitów **nie zmieniłoby licencji**, tylko
sprawiło, że historia twierdziłaby coś nieprawdziwego. Okres ISC był faktem —
wersje 0.1.0–0.1.5 zostały wydane na tej licencji i kto je pobrał, ma prawa
z ISC bezterminowo. O licencji decyduje **bieżące drzewo**: `LICENSE`, pole
w `package.json`, metadane paczek i zakładka „O programie" — wszystko mówi
GPL-3.0-or-later i to jest jednoznaczne.

Techniczna strona, gdyby kiedyś wróciło: `git filter-branch --tree-filter`
przeszedłby po 30 commitach, podmieniając pole `license` i dokładając `LICENSE`.
Wykonalne w minutę; problem nie jest techniczny.

### Stary PIN SQ8BWA w obiektach GitHuba — zamknięte, zostaje jak jest
**Rozstrzygnięte 2026-09-04.** Zgłoszenia do GitHub Support **nie wysyłamy** —
sprawdzone w dokumentacji (*Removing sensitive data from a repository*):

> GitHub Support won't remove non-sensitive data, and will only assist in the
> removal of sensitive data in cases where we determine that the risk can't be
> mitigated by rotating affected credentials.

PIN został wymieniony 2026-09-02, więc ryzyko jest zażegnane rotacją i GitHub
takiej prośby nie realizuje. Wcześniejsza notatka w tym miejscu twierdziła, że
„robią to bez dyskusji" — to było powtórzone przekonanie, nie sprawdzony fakt.

Stan faktyczny, dla porządku:

- blob jest nieosiągalny z jakiejkolwiek gałęzi i tagu, ale nadal dawał się
  pobrać po SHA (sprawdzone 2026-09-03);
- po upublicznieniu repozytorium (2026-09-04) może go pobrać każdy, **kto zna
  jego SHA** — a SHA nie da się zgadnąć ani wyklikać, i nie ma go w żadnym
  publicznym odnośniku;
- zawiera **wyłącznie** stary, wymieniony PIN konta SQ8BWA, dwa razy. PIN-u
  SQ8BWM tam nie ma, innych sekretów też nie;
- 0 forków i 0 otwartych pull requestów, więc nic tego nie rozprzestrzenia.

Jedyna droga z gwarancją to skasowanie i odtworzenie repozytorium — a to dziś
znaczy utratę publicznego adresu i czterech wydań z pobraniami. Nieproporcjonalne
do martwych bajtów.

**Wniosek na przyszłość zostaje ten sam i jest jedyną rzeczą, która tu naprawdę
działa: nie commitować surowych logów pracy.** Log mostka pokazuje ładunki żądań
razem z PIN-ami celów. Od 0.1.10 tryb próbny PIN-u już nie zapisuje, a `*.log`
jest w `.gitignore`.

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

**Pytanie zadane autorowi serwisu 2026-09-03** (razem z pytaniem, czy pole
`operator` jest w ogóle walidowane). Czekamy na odpowiedź — nie zgadujemy dalej.

## Funkcjonalne

### Wykorzystanie API do walidacji — czekamy na dwie zmiany w serwisie
Autor serwisu **rozszerzył API 2026-09-04** (`stations`, `activeActions`,
`pinExpires`, `apiEnabled` w `PING`/`STATUS`, plus `action=VALIDATE`).
Sprawdzanie konfiguracji **jest już zrobione** — patrz
[docs/konfiguracja.md](docs/konfiguracja.md#sprawdzanie-konfiguracji-wobec-konta-od-019).

Zgłoszenie **wysłane 2026-09-04**, czekamy na odpowiedź. Zmierzone i zgłoszone,
blokuje dalsze kroki:

1. **`is_validation_only` tylko przy sukcesie.** Gdy walidacja stwierdza, że QSO
   nigdzie nie wejdzie, odpowiedź jest bajt w bajt taka jak przy nieudanym
   PRAWDZIWYM zapisie — a to właśnie ten przypadek jest wart sprawdzania.
   Dopóki tak jest, nie użyjemy VALIDATE do przycisku „sprawdź to QSO".
2. **Brak `reason`.** „Stacja bez uprawnień" i „data poza zakresem akcji" dają
   identyczny komunikat, więc nie da się użytkownikowi powiedzieć, co poprawić.
   Poprosiliśmy o `NO_STATION_RIGHTS` / `NO_ACTIVE_ACTION` / `ACTION_CLOSED` /
   `WOULD_BE_DUPLICATE`, przy VALIDATE i przy zwykłym zapisie.

Dwie mniejsze prośby w tym samym zgłoszeniu: `INVALID_CALLSIGN` wraca dla trzech
różnych pól (korespondent, stacja, operator) i rozróżnia je tylko polski tekst —
prosiliśmy o `field` albo osobne kody; `savedTo: []` przy `success: true` nadal
nie ma kodu błędu.

Otwarte pytania do autora: czy `PING` wchodzi w limit 10/min razem z zapisami
(dziś zakładamy ostrożnie, że tak — cudze konta odpytujemy tylko na starcie
i po zapisie), oraz czy `PING` i `STATUS` mają celowo zwracać to samo.

**Ustalone przy okazji:** PIN nie ma daty ważności (`pinExpires: null`) poza
banem/blokadą konta. Nie można logować do akcji zakończonej dawniej niż 7 dni —
to dotyczy naszego ponawiania: QSO leżące długo w `failed/` może już nie wejść.
Pole `operator` jest walidowane jako znak krótkofalarski (max 15 znaków,
ucinane), z żadną listą nie jest wiązane.

### Ostrzeżenie o złym znaku operatora — bez własnego wzorca znaku
Pole `operator` jest walidowane przez serwis jako znak krótkofalarski: wartość
niebędąca znakiem odbija QSO (`INVALID_CALLSIGN`, HTTP 400), a dłuższa niż
15 znaków jest po cichu **ucinana**. Dziś mostek wysyła to bez ostrzeżenia.

**Nie piszemy własnego wzorca znaku.** Ustalone 2026-09-04, po pytaniu „jak
chcesz rozpoznawać zły znak":

- Regexa serwisu nie znamy. Każda reguła strukturalna (prefiks litera+cyfra,
  długość sufiksu) ma dziesiątki wyjątków: znaki okolicznościowe, `/P`, `/MM`,
  `3Z0X`. Autor serwisu wprost mówi, że przechodzą `SP1ZOSIA` i `SP1BLABLABLA`.
- Koszty są niesymetryczne: uznanie poprawnego znaku za zły to zablokowane albo
  opóźnione QSO, a przepuszczenie złego to jedno odbicie do `failed/`, ratowane
  jednym kliknięciem. Surowość jest więc droższa od pobłażliwości.

Co robić, w kolejności wartości:

1. **Znaki poza `A–Z`, `0–9`, `/`** — ostrzegać. To jedyne, co zmierzyliśmy jako
   odrzucone (`NIE ZNAK!` — spacja i wykrzyknik).
2. **Dłuższe niż 15 znaków** — ostrzegać, i to jest ważniejsze od punktu 1:
   serwer nie odrzuca, tylko ucina, więc QSO zapisuje się pod **innym**
   operatorem niż zamierzony, bez żadnego sygnału błędu.
3. **W polu „Operator" w oknie konfiguracji** surowość jest bezpieczna —
   wpisuje je człowiek, więc pytanie przy zapisie (jak przy znakach stacji) to
   czysty zysk. Nic nie leci, nic nie ginie.
4. **Dla wartości z loggera — żadnej blokady wysyłki.** Tylko wpis w zdarzeniach
   i w logu.

**Docelowo właściwe rozwiązanie:** nie odtwarzać reguł serwisu, a zapytać go
przez `action=VALIDATE`. To jedyne źródło prawdy o tym, co przyjmie. Czeka na
`is_validation_only` na ścieżce odrzucenia — patrz pozycja o walidacji wyżej.

### Statystyki — zrobione, co jeszcze warto dołożyć
Zakładka i importer historii gotowe w 0.1.10 —
[docs/statystyki.md](docs/statystyki.md). Historia z logów wczytana: 1114 kopii,
372 QSO, 31.08–03.09 (z 1119 wpisów logu odsiane 2 przejścia próbne i 3 kopie
QSO testowego `SN0TEST`).

Do rozważenia, gdy pojawi się potrzeba:

- **Eksport do CSV/ADIF** — dziennik jest w JSON Lines, więc to kilka linii kodu.
- **Wykres w czasie** zamiast listy pasków; dziś przy 14 dniach lista wystarcza.
- **Porównanie z serwisem** — ile QSO widzi radiodyplom na danej akcji. Wymaga
  endpointu, którego nie ma; sensowne dopiero razem z resztą zapytania do autora.
- **Wygasanie dziennika.** Przy tempie 300 QSO/dzień to ~1 MB na miesiąc, więc
  jeszcze długo nie problem. Podział na pliki miesięczne jest już zrobiony, więc
  usuwanie starych będzie trywialne.

### Wrzucanie spotów — pomysł, nie zamówienie
Zgłoszone 2026-09-04 jako „może kiedyś". Nic nie było jeszcze ustalane, więc
zapisuję tylko to, co trzeba będzie rozstrzygnąć NA POCZĄTKU, żeby nie zacząć
od budowania złej rzeczy:

- **Gdzie spotować.** Klaster DX (telnet, protokół tekstowy), SOTAwatch/POTA
  (HTTP), czy radiodyplom, gdyby dorobił u siebie spoty? To trzy różne
  rozwiązania i różne dane logowania.
- **Kogo spotować: siebie czy korespondenta.** Aktywator spotuje siebie
  („jestem na 7.144"), a to znaczy, że dane NIE pochodzą z QSO, tylko ze
  stanu radia albo z ręcznego wpisu. Kolejka QSO jest tu bez znaczenia.
- **Czy z automatu.** Spot po każdym QSO to zaśmiecanie klastra; realnie
  potrzebne jest „wrzuć spot teraz" na żądanie albo po zmianie pasma.

Loggery wysyłają nam tylko zalogowane QSO, więc częstotliwość bieżąca jest
znana wyłącznie wtedy, gdy właśnie coś zalogowano. Jeśli spot ma być
niezależny od QSO, trzeba będzie osobnego źródła (CAT z radia albo pole
w oknie) — i to jest największa nieznana tej pozycji.

### QLog wysyła DWA datagramy na jedną edycję — zmierzone, zamknięte
**Rozstrzygnięte 2026-09-04 pomiarem.** Jedna poprawka rekordu w QLogu daje
**dwa** datagramy z `operation: "update"`.

Dwie niezależne obserwacje, zgodne:

| Czynność operatora | Datagramy pominięte |
|---|---|
| 2 poprawki (z pamięci) | 4 |
| **1 poprawka (kontrolowana)** | **2** |

Zamyka to rozbieżność, która wyszła przy pierwszym pytaniu: okno pokazywało
4 pominięcia, a operator pamiętał dwie edycje i żadnego usunięcia. Wszystko się
zgadza — **datagram nie jest tym samym co czynność użytkownika**.

Wniosek na przyszłość: licznik pominięć liczy **datagramy** i tak ma być, bo to
one przychodzą na port. Ale przy czytaniu liczby trzeba pamiętać o mnożniku,
i dlatego jest o tym podpowiedź w oknie oraz wzmianka w `docs/loggery.md`.

Nie sprawdzone i na razie bez potrzeby: czy `delete` też daje dwa datagramy
i czy inne loggery mają podobne zachowanie.

### Windows 7 i 8 — nie obsługujemy i nie da się
Zgłoszone 2026-09-05: na 64-bitowym Windows 7 program nie startuje ani
zainstalowany, ani przenośny — *„nie jest prawidłową aplikacją systemu Win32"*.
To komunikat systemu, nie programu; Windows odmawia wczytania pliku, zanim nasz
kod wystartuje.

Sprawdzone w README samego Electrona, nie z pamięci:

| | |
|---|---|
| Electron 22 | `Windows (Windows 7 and up)` — ostatni, bez wsparcia od X 2023 |
| Electron 23+ | `Windows (Windows 10 and up)` |
| u nas | 44 |

**Tryb bez okna też nie ratuje**: Node 16 wymaga Windows 8.1, Node 18+ wymaga
Windows 10 (tabela w `BUILDING.md` Node'a). Nasz kod używa `AbortSignal.timeout`
i ustawień Happy Eyeballs, czyli rzeczy nowszych niż Node 16.

Budowa na Electronie 22 odpada: Chromium bez łatek od dwóch lat plus
przepisywanie kodu pod stary Node. Nieproporcjonalne i szkodliwe.

**Rozwiązanie dla użytkownika:** mostek na innej maszynie w tej samej sieci,
logger wysyła UDP przez sieć. Opisane w
[docs/windows-i-siec.md](docs/windows-i-siec.md#windows-7-i-8--program-się-nie-uruchomi).

**Nasza wina była jedna i już naprawiona:** nigdzie nie było napisane, jakiego
Windowsa program wymaga. Użytkownik pobierał i dostawał komunikat, z którego nic
nie wynika.

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

### Aktualizacje aplikacji — powiadomienie zrobione, samoaktualizacji NIE robimy
Od 0.1.11 program sprawdza, czy jest nowsze wydanie, i mówi o tym w oknie
(odznaka + zakładka „O programie"). Nie pobiera i nie instaluje niczego sam.

**Samoaktualizacji świadomie nie wprowadzamy**, ustalone 2026-09-04:

1. Mostek pracuje godzinami w trakcie akcji. Restart przerywa nasłuch UDP,
   a QSO wysłane przez logger w tym oknie **nie ma jak wrócić** — UDP nie
   ponawia. To jedyny powód, który wystarcza sam.
2. Objęłaby dwie postacie z czterech: `latest.yml` opisuje wyłącznie instalator
   NSIS, `latest-linux.yml` wyłącznie AppImage (sprawdzone w wygenerowanych
   plikach). `.deb` i wersja przenośna i tak zostają z powiadomieniem.
3. Bez podpisu kodu pobrany instalator trafi na SmartScreen.

Gdyby kiedyś wracać do tematu: `electron-updater` + sekcja `publish`
w `electron-builder.yml` + wgrywanie `latest*.yml` do wydania (dziś ich NIE
wgrywamy) — i twarda reguła „nigdy nie restartuj sam, tylko zaproponuj po
zamknięciu".

Repozytorium `apt` dla `.deb` byłoby „właściwą" drogą dystrybucji, ale to własny
serwer albo PPA, klucze GPG i utrzymanie — nieproporcjonalne do skali.

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
- **PIN przy celu rozgałęziania i znacznik „Aktywna"** (2026-09-03). Model
  ustalony ostatecznie: PIN należy do KONTA, konto ma listę przypisanych stacji,
  a serwer sprawdza wyłącznie `station_callsign` — `operator` jest polem
  opisowym i nie jest weryfikowany. Dlatego PIN przy celu jest potrzebny tylko
  wtedy, gdy stacja nie jest przypisana do własnego konta. Bez bazy użytkowników:
  jedno pole przy regule wystarcza.
  PIN celu ma cztery stany (nieprzysłany / zamaskowany / nowy / pusty), bo bez
  rozróżnienia „nie przysłano" od „przysłano puste" klient nieznający tego pola
  po cichu kasowałby cudze PIN-y. Usunięcie jest za potwierdzeniem.
  Znacznik `enabled` wyłącza regułę **bez utraty danych**; wyłączenie wszystkich
  zachowuje się jak brak reguł (jedno QSO ze stacją z loggera), a nie jak brak
  wysyłki. 220 testów; trzy mutacje wywalają właściwe testy.
- **Test słownika po raz drugi udowodnił swoją wartość**: przy dodawaniu etykiet
  te same klucze znów trafiły dwa razy do bloku polskiego (linia
  `'hint.targetIncomplete':` jest identyczna w obu językach). Wyłapane od razu,
  zamiast na zrzucie ekranu jak poprzednio.
- **Okno logu: nie dało się czytać ani nie rosło z oknem.** Skok na koniec był
  bezwarunkowy, więc każde odświeżenie (co 2 s) wyrywało widok z powrotem;
  wysokość pola była wpisana na sztywno (460 px). Teraz: przewijanie za logiem
  tylko wtedy, gdy widok JEST na końcu, plus wskaźnik stanu i przycisk „Na
  koniec"; przy niezmienionej treści DOM nie jest ruszany wcale. Wysokość
  liczona z faktycznego położenia pola (`fitLogBox`), bo `flex` na całym
  układzie powodował przewijanie strony zamiast logu, a sztywne odejmowanie
  rozjeżdżało się przy zawiniętym nagłówku. Długie linie JSON łamane
  (`overflow-wrap:anywhere`) — koniec z poziomym paskiem.
- **Cały łańcuch obsługi odrzuconych potwierdzony w prawdziwej pracy** (2026-09-02,
  0.1.7): QSO na stację `SQ8BWA` wróciło jako odrzucone i było to widoczne od razu
  — czerwony wiersz w zdarzeniach i plakietka. Po dopisaniu stacji do listy konta
  w Managerze i kliknięciu „Ponów odrzucone" łączności przeszły. Czyli: sygnalizacja
  pokazała problem, komunikat wskazał przyczynę, a ponowienie odzyskało QSO.
- **PIN konta SQ8BWA wygenerowany od nowa** (2026-09-02) po znalezieniu starego
  w plikach `.swp` w historii gita. Stary PIN jest bezwartościowy, sprawa zamknięta.
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
