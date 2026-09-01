# radiodyplom-bridge

Daemon pośredniczący między **loggerem krótkofalarskim** a **radiodyplom.pl**.
Każda zalogowana łączność trafia po UDP do daemona, ląduje w trwałej kolejce na dysku
i jest wysyłana na `qso_upload.php`. Przy braku łączności QSO czekają w buforze
i są ponawiane.

```
logger ──UDP──► daemon ──HTTPS──► radiodyplom.pl/qso_upload.php
                  │
                  ├── auto-rozpoznanie formatu datagramu
                  └── kolejka na dysku (przetrwa restart, retry z backoffem)
```

## Wymagania

**Rdzeń (tryb headless):** Node.js ≥ 18 — używa tylko wbudowanego `fetch` i stabilnych
API. Zero zależności runtime.

**Interfejs Electron:** Node.js ≥ 22.12. Nie jest to wymóg samego Electrona, a jego
narzędzia instalacyjnego `@electron/get` w wersji 5 — a tej używają **wszystkie trzy
wspierane linie Electrona** (42, 43, 44). Nie ma więc drogi pośredniej: na starszym
Node da się zainstalować tylko Electron ≤ 41, czyli wersje poza wsparciem, z
niełatanym Chromium.

Projekt jest rozwijany na **Node 24 LTS** i **Electron 44**. Jeśli Twój systemowy Node
jest starszy, użyj `nvm` — nie ruszaj Node z pakietów systemu, bo mogą od niego
zależeć inne programy:

```bash
nvm install 24 && nvm use 24
npm install
```

Uwaga na niuans: wymóg ≥ 22.12 dotyczy **instalacji** Electrona, nie jego uruchamiania.
Raz pobrana binarka startuje także pod Node 18 (sprawdzone). Dlatego `engines` w
`package.json` mówi `>=18` — tyle wymaga rdzeń, który jest właściwym produktem.

`electron-builder` (etap pakowania) wymaga tylko Node ≥ 14, więc nie jest tu wąskim gardłem.

## Obsługiwane loggery
Daemon rozpoznaje format **automatycznie po zawartości datagramu**, więc jeden port
obsługuje mieszane źródła jednocześnie.

| Dekoder | Format | Loggery |
|---|---|---|
| `QLog` | JSON `{appid:"QLog", data:{value:"<ADIF>"}}` | QLog |
| `N1MM` | XML `<contactinfo>` | N1MM+, DXLog, BBlogger, Log4OM (tryb N1MM) |
| `WSJT-X` | binarny QDataStream, magic `0xADBCCBDA`, typ 5 | WSJT-X, JTDX ≥ 2.2.158, MSHV |

Rozpoznanie jest jednoznaczne, bo rodziny różnią się pierwszymi bajtami:
`{` → JSON, `<` → XML, `AD BC CB DA` → binarny.

**Nieobsługiwane** (własne, odrębne protokoły): QARTest (9458), Swisslog (2333),
Win-Test (9871), Ham Radio Deluxe, WriteLog, LogHX. Każdy wymaga własnego dekodera —
dodanie polega na dopisaniu jednego pliku w `src/decoders/` i wpisaniu go do rejestru.

## Konfiguracja loggera
Ustaw wysyłkę UDP na `127.0.0.1:12060` (albo inny port, byle zgodny z `config.json`):

- **QLog** — `Settings → Network → Notifications → QSO Changes`
- **N1MM+ / DXLog** — broadcast na porcie 12060 (domyślny dla tej rodziny)
- **WSJT-X / JTDX / MSHV** — `Settings → Reporting → UDP Server` + port

WSJT-X wysyła „QSO Logged” dopiero po zatwierdzeniu okna **Log QSO** — to celowe
zachowanie samego WSJT-X, nie ograniczenie daemona.

## Konfiguracja daemona
```bash
cp config.example.json config.json   # config.json jest w .gitignore
```
W `config.json` wstaw PIN API z Managera radiodyplom
(*Dostęp API → Generuj nowy PIN API → Zapisz PIN API*). Alternatywnie zmienna
środowiskowa `RD_PIN` nadpisuje wartość z pliku.

| Opcja | Znaczenie |
|---|---|
| `radiodyplom.pin` | PIN/klucz API akcji dyplomowej |
| `radiodyplom.dryRun` | `true` = nic nie wysyła, tylko loguje (do testów) |
| `udp.port` | port nasłuchu (musi zgadzać się z loggerem) |
| `forward.operations` | które operacje QLog przekazywać (domyślnie `["insert"]`) |
| `queue.maxAttempts` | ile prób przed odłożeniem do `data/failed/` |
| `rateLimit.maxPerMinute` | limit wysyłek (API dopuszcza 10/min, trzymamy 9) |

## Użycie
```bash
npm run ping        # sprawdź PIN (zwraca znak operatora)
npm start           # uruchom daemona
npm run queue       # stan kolejki i błędów
npm run requeue     # przywróć z failed/ do kolejki po awarii sieci

# syntetyczne QSO – test bez prawdziwego loggera
npm run send-test -- SP9TEST 40m SSB --format qlog
npm run send-test -- SP9TEST 20m SSB --format n1mm
npm run send-test -- SP9TEST 30m FT8 --format wsjtx
```

**Zalecane przy pierwszym uruchomieniu:** zostaw `dryRun: true`, zaloguj próbne QSO
i sprawdź w logu, że mapowanie pól jest poprawne. Potem przestaw na `false`.

## Normalizacja danych
Loggery podają dane w różnych postaciach, więc dekodery je ujednolicają:

- **Pasmo.** QLog podaje gotowe `band: "40m"`. N1MM i WSJT-X nie — pasmo jest
  wyliczane z częstotliwości (`src/bands.js`, zakresy wg ADIF).
  Uwaga: N1MM podaje `txfreq` w **jednostkach 10 Hz** (`352519` = 3.52519 MHz),
  a `<band>` jako MHz (`3.5`) — nie jako pasmo.
- **Emisja.** Tylko jednoznaczne odwzorowania: `USB`/`LSB` → `SSB` (to podmody SSB
  w rozumieniu ADIF). `SSB`, `FM`, `CW`, `FT8`, `PSK31` itd. przechodzą bez zmian.
  `PHONE` **nie jest** mapowane na `SSB` — na 2 m i 70 cm fonia bywa zarówno FM
  (segmenty FM), jak i SSB (144.000–144.400, 432.000–432.400), więc odwzorowanie
  po samym paśmie myliłoby się w którąś stronę. Emisja wpływa na punktację akcji,
  dlatego wartości niejednoznaczne przechodzą surowe i są widoczne w logu
  (patrz `src/modes.js`).
- **Czas.** WSJT-X przesyła `QDateTime` jako Julian Day + milisekundy — przeliczane
  na `qso_date`/`time_on`.
- **Operator.** Gdy logger nie podaje operatora, używany jest znak stacji.

## Mapowanie na radiodyplom (potwierdzone realnym uploadem)

Pełne pokrycie formularza „Edytuj łączność" w Managerze — QSO id 996530:

| Pole formularza | Pole API | Skąd |
|---|---|---|
| Data | `qso_date` | ADIF `qso_date` |
| Czas | `time_on` | `HHMMSS`, zapisywany co do sekundy |
| Uczestnik | `callsign` | znak korespondenta |
| **Stacja SES** | `station_callsign` | znak stacji akcji |
| **Operator** | `operator` | znak operatora — **pole niezależne od Stacji SES** |
| Częstotliwość (FREQ) | `freq` | wysyłamy w MHz, serwer przelicza na kHz |
| Pasmo | `band` | |
| Emisja | `mode` | |
| RST wysłany / odebrany | `report_sent` / `report_received` | |
| Klucz: (COMMENT) | `comment` | |

`Stacja SES` i `Operator` są przechowywane osobno — wysłanie
`station_callsign=SQ8BWM` + `operator=SP0OPER` daje w formularzu dokładnie te dwie
różne wartości. Dlatego nie ma odwzorowania „operator → stacja”; brak
`station_callsign` powoduje odrzucenie QSO, a nie podstawienie znaku operatora.

**Uwaga przy weryfikacji:** publiczny feed `ajax_latest_qso.php` ma pole o nazwie
`operator`, ale zawiera ono **Stację SES**, nie operatora. Nie nadaje się więc do
sprawdzania pola `operator` — do tego służy formularz w Managerze.

**Precyzja częstotliwości:** serwer zapisuje pełne kHz. `7.0745` MHz zostaje
zaokrąglone do `7075` kHz. Dla akcji dyplomowych bez znaczenia, ale warto wiedzieć.

## Mapowanie pól
| Pole znormalizowane | radiodyplom |
|---|---|
| `call` | `callsign` |
| `qso_date`, `time_on`, `band`, `mode` | tak samo |
| `rst_sent` / `rst_rcvd` | `report_sent` / `report_received` |
| `station_callsign`, `operator`, `freq`, `gridsquare`, `comment`, `name`, `qth` | tak samo |

Znaki i emisja idą wielkimi literami, pasmo małymi (konwencja ADIF: `40m`).
Wymagane przez serwer: `callsign`, `qso_date`, `station_callsign` — QSO bez nich
jest pomijane z ostrzeżeniem w logu.

## Interfejs graficzny (Electron)

```bash
npm install      # electron jako zależność deweloperska
npm run ui
```

Aplikacja żyje **w zasobniku systemowym**. Zamknięcie okna ją tylko ukrywa —
mostek pracuje dalej.

**Aby zakończyć program, użyj przycisku „Zakończ" w oknie.** Menu pod ikoną
w zasobniku robi to samo, ale nie na każdym systemie jest dostępne (na Windows
potrafi się nie pokazywać), więc przycisk w oknie jest drogą pewną.

Ikona pokazuje stan bez otwierania okna:

| Kolor | Znaczenie |
|---|---|
| zielona | działa, łączność jest |
| **czerwona** | **brak łączności z radiodyplom** — QSO czekają w kolejce i będą dosłane automatycznie |
| żółta | wysyłka wstrzymana ręcznie, albo są QSO odrzucone (wymagają Twojej decyzji) |

Brak łączności rozpoznawany jest **dwiema drogami**, żeby nie umknął w żadnym scenariuszu:
- **cykliczny PING** (domyślnie co 60 s, `radiodyplom.pingIntervalMs`) — wykrywa problem
  także wtedy, gdy kolejka jest pusta i nic nie próbuje się wysłać;
- **realna próba wysyłki** — flaga `queue.online` gaśnie, gdy POST nie przeszedł
  z powodu sieci. To sygnał najwierniejszy, bo wynika z faktycznego żądania.

Błąd trwały (zły znak, brak uprawnień) **nie** gasi łączności — to problem z danymi,
nie z siecią, i dlatego daje stan żółty, a nie czerwony.

### Język
Przełącznik **Polski / English** w nagłówku okna. Wybór zapamiętywany w konfiguracji
(`language`), więc obowiązuje też dla menu i podpowiedzi w zasobniku oraz po restarcie.
Tłumaczenia siedzą w jednym słowniku `ui/strings.js` — bez żadnej biblioteki.

Komunikaty błędów z API przychodzą **po polsku z serwera**, dlatego przy angielskim
interfejsie tłumaczymy je **po kodzie** (`INVALID_CALLSIGN`, `NOT_SAVED`,
`INVALID_API_KEY`…), a treść serwera zostaje w nawiasie jako uzupełnienie.

Cztery zakładki:
- **Stan** — liczniki, adres nasłuchu, rozbicie na źródła (QLog / N1MM / WSJT-X),
  ostatnie wysłane QSO i ostatni błąd.
- **Kolejka** — co czeka i co zostało odrzucone: znak, stacja, **operator**, liczba prób,
  powód. Operator jest tu istotny przy rozmnażaniu QSO: dwie kopie tej samej łączności
  różnią się stacją *i* operatorem, więc bez tej kolumny nie odróżnisz ich od siebie.
- **Konfiguracja** — PIN, tryb próbny, adres i port nasłuchu, grupy multicast,
  cele rozmnażania QSO.
- **Log** — bieżące zdarzenia.

**PIN-y są w UI zawsze zamaskowane** (`ABCD-****`), także PIN-y celów fan-outu.
Pole zostawione zamaskowane oznacza „nie zmieniaj"; nowy PIN wpisuje się w całości.
Renderer nie ma dostępu do Node ani do rdzenia — wszystko idzie przez wąski most
IPC w `preload.cjs`.

### Co działa od razu, a co po restarcie
Od razu: PIN, tryb próbny, adres API, cele fan-outu i ich PIN-y, limity tempa,
poziom logowania, język.

Po restarcie: `udp.host`, `udp.port`, `udp.multicastGroups`, `api.port`, `api.enabled`,
`dataDir` i ścieżki kolejki — gniazdo UDP i kolejka są otwarte od startu procesu.

Zapis zwraca `restartRequired` (co właśnie wymaga restartu) oraz `pendingRestart`
(wszystko, co go jeszcze czeka). Dopóki lista nie jest pusta, nad zakładkami wisi
**trwały żółty banner**, a podpowiedź ikony w zasobniku dopisuje „wymaga restartu".

Banner jest sterowany stanem, nie odpowiedzią na zapis — jednorazowy komunikat
ginął przy przełączeniu zakładki, a wtedy zakładka Konfiguracja pokazywała nową
wartość, a Stan starą, bez niczego, co by je łączyło.

### Architektura UI
Electron **osadza rdzeń we własnym procesie** (`startDaemon`) i rozmawia z nim
bezpośrednio, bez HTTP. Serwer stanu zostaje włączony tylko po to, by dało się
podejrzeć mostek z przeglądarki lub skryptu.

Rdzeń nie wie o istnieniu UI. `npm start` uruchamia go bez Electrona — na
Raspberry Pi w shacku czy jako usługa systemd — i to jest zachowanie docelowe,
a nie tryb awaryjny.

## API stanu (dla UI)

Daemon wystawia lokalną powierzchnię stanu, z której korzysta interfejs użytkownika
(Electron albo zwykła przeglądarka). Włączona domyślnie:

```json
"api": { "enabled": true, "port": 12061 }
```

| Metoda | Ścieżka | Działanie |
|---|---|---|
| GET | `/api/status` | pełny stan: nasłuch, statystyki źródeł, kolejka, liczniki, ostatnie QSO i błąd |
| GET | `/api/log?n=50` | ostatnie zdarzenia z logu (bufor 300 wpisów) |
| POST | `/api/pause` | wstrzymuje **wysyłkę**; odbiór z loggera i kolejkowanie działają dalej |
| POST | `/api/resume` | wznawia wysyłkę |
| POST | `/api/requeue` | przywraca QSO z `failed/` do kolejki |

Dwie decyzje projektowe, świadome i celowe:

> **Serwer nasłuchuje wyłącznie na `127.0.0.1`** — niezależnie od `udp.host`. To jest
> interfejs *sterujący* wysyłką QSO na Twoim PIN-ie; wystawienie go na sieć oddałoby
> obcym kontrolę nad Twoim logiem.

> **PIN-y nigdy nie opuszczają procesu.** W `/api/status` są zamaskowane (`ABCD-****`),
> tak samo PIN-y celów fan-outu. UI nie potrzebuje ich w jawnej postaci.

Jeśli **port API** (12061) jest zajęty, daemon loguje ostrzeżenie i pracuje dalej —
brak podglądu nigdy nie może zatrzymać przekazywania QSO. Sprawdzone: przy zajętym
12061 QSO z loggera nadal przechodzi.

To dotyczy **wyłącznie portu API**. Port UDP, na którym słucha logger, to osobna
sprawa — patrz „Zajęty port UDP" niżej.

`queue.pending` / `queue.failed` / `queue.sent` to **liczniki**, a `pendingItems`
i `failedItems` to listy przycięte do 50 pozycji — nie myl ich przy budowie UI.

## Windows i praca w sieci shacku

Rdzeń nie ma zależności natywnych ani niczego systemowo zależnego — działa na
Windows na tym samym Node ≥ 18. Poniżej rzeczy, które trzeba ustawić świadomie.

### Skąd odbierać datagramy
| `udp.host` | Co odbiera | Kiedy |
|---|---|---|
| `127.0.0.1` (domyślnie) | tylko z tej samej maszyny | logger i daemon na jednym komputerze |
| `0.0.0.0` | ze wszystkich interfejsów, w tym **rozgłoszeniowe** | logger na innym komputerze w shacku, albo wysyłka na adres rozgłoszeniowy |

N1MM+, DXLog i pokrewne często wysyłają na adres **rozgłoszeniowy** sieci, a nie na
localhost — wtedy `127.0.0.1` nie odbierze nic. To najczęstsza przyczyna „nie działa".

> ⚠️ **`0.0.0.0` otwiera port na całą sieć lokalną.** Każdy w tej sieci może wtedy
> wysłać datagram, który daemon zapisze na Twoim PIN-ie do Twojej akcji. W sieci
> domowej to zwykle akceptowalne; w sieci publicznej lub klubowej — przemyśl to.

### Multicast
Niektóre loggery nadają na grupę multicast (WSJT-X domyślnie `224.0.0.222`):
```json
"udp": { "host": "0.0.0.0", "port": 12060, "multicastGroups": ["224.0.0.222"] }
```
Dołączenie do grupy wymaga `host: "0.0.0.0"`; przy innym bindzie daemon ostrzeże.

Sprawdzone: przy `0.0.0.0` odbierane są datagramy unicast na adres LAN, rozgłoszeniowe
i multicastowe.

### Zapora Windows
Przy pierwszym uruchomieniu Windows zapyta o zezwolenie dla Node/aplikacji na
przyjmowanie połączeń. Bez zgody dla **sieci prywatnej** datagramy z innych maszyn
nie dojdą.

### Katalog danych
`dataDir` decyduje, względem czego liczone są ścieżki z sekcji `queue`:

| Wartość | Baza |
|---|---|
| brak (domyślnie) | katalog programu — wygodne przy uruchamianiu z repozytorium |
| `"auto"` | katalog systemowy użytkownika |
| własna ścieżka | ta ścieżka |

`"auto"` daje: Windows `%APPDATA%\radiodyplom-bridge`, Linux
`~/.local/share/radiodyplom-bridge`, macOS `~/Library/Application Support/…`.
**Po zainstalowaniu aplikacji ustaw `"auto"`** — katalog w `Program Files` nie jest
zapisywalny, a kolejka musi mieć gdzie trwać.

### Autostart
- **Windows:** Harmonogram zadań — wyzwalacz „przy logowaniu", akcja: `node src\index.js`
  (albo plik wykonywalny po spakowaniu), „Uruchom niezależnie od tego, czy użytkownik
  jest zalogowany" tylko jeśli daemon ma działać bez sesji.
- **Linux:** usługa systemd użytkownika (`~/.config/systemd/user/`), `systemctl --user
  enable --now`.

Kolejka jest odporna na twarde ubicie procesu (zapis atomowy), więc restart maszyny
nie uszkodzi danych — niewysłane QSO zostaną dosłane po starcie.

## Testy

```bash
npm test        # node --test test/*.test.js
```

99 testów na wbudowanym `node:test` — **bez żadnych zależności**, spójnie z rdzeniem.
Pokryte: parser ADIF, granice pasm, normalizacja emisji, wszystkie trzy dekodery
(w tym Julian Day WSJT-X i jednostki 10 Hz w N1MM), mapowanie na format radiodyplom,
rozmnażanie QSO, klasyfikacja odpowiedzi API, kolejka i blokady (także **między
procesami**, przez `spawn`), konfiguracja i jej edycja z interfejsu.

Zasada: **każdy błąd znaleziony w rozwoju ma test regresyjny**, opisany komentarzem
`// REGRESJA:` z wyjaśnieniem, co się psuło. Najgroźniejsze z nich dotyczyły cichej
utraty QSO — odpowiedź `success:true` z pustym `savedTo`, wspólny klucz kopii
fan-outu, oznaczanie awarii sieci jako obsłużonej.

Skuteczność zestawu sprawdzona mutacjami: cofnięcie poprawki zawsze wywala
odpowiedni test, a nie tylko „przechodzi na zielono".

## Pakowanie i dystrybucja

```bash
npm run pack:linux    # AppImage
npm run pack:win      # instalator NSIS + wersja przenośna
npm run pack          # oba
```
Artefakty trafiają do `release/` (ok. 94–119 MB każdy). Nazwy są **bez spacji** —
GitHub zamienia spacje na kropki przy wgrywaniu załączników do wydania, przez co
plik sum kontrolnych przestawał pasować do tego, co odbiorca pobiera. Windows buduje się **z
Linuksa** — electron-builder sam dociąga NSIS, wine nie jest potrzebne.

Każde pakowanie kończy się wygenerowaniem **`release/SHA256SUMS`** (osobno:
`npm run checksums`). Plik jest w formacie zgodnym z `sha256sum`, więc odbiorca
sprawdza pobranie jednym poleceniem:

```bash
cd release && sha256sum -c SHA256SUMS
```

Ma to znaczenie, bo **instalatorów nie podpisujemy certyfikatem** (uzasadnienie
w `BACKLOG.md`) — suma kontrolna jest wtedy jedynym sposobem, w jaki odbiorca może
stwierdzić, że pobrał dokładnie to, co zostało zbudowane. Pliki pomocnicze
electron-buildera (`.blockmap`, `builder-debug.yml`, katalogi `*-unpacked`) są
pomijane; liczone są tylko gotowe paczki.

### Gdzie po instalacji leżą dane
Katalog programu jest wtedy tylko do odczytu, więc konfiguracja i kolejka idą do
katalogu użytkownika. Sterują tym dwie rzeczy: `RD_CONFIG_DIR` (Electron podstawia
tam katalog danych aplikacji) oraz `dataDir: "auto"` we wzorcu konfiguracji.

| | Windows | Linux |
|---|---|---|
| `config.json` | `%APPDATA%\radiodyplom-bridge` | `~/.config/radiodyplom-bridge` |
| kolejka i dane | `%APPDATA%\radiodyplom-bridge` | `~/.local/share/radiodyplom-bridge` |

Odinstalowanie **nie usuwa** tych katalogów (`deleteAppDataOnUninstall: false`) —
niewysłane QSO są cenniejsze niż czystość deinstalacji.

### Pierwsze uruchomienie u nowego użytkownika
Program zasiewa `config.json` z dostarczonego wzorca (`pin: WSTAW-PIN`,
`dryRun: true`) i **wstaje bez PIN-u** — inaczej nie byłoby gdzie go wpisać.
Plakietka pokazuje wtedy „brak PIN-u API", a panel podpowiada, gdzie go podać.
Sprawdzone na czystym koncie z prawdziwej paczki.

### Sekrety nie trafiają do paczki
`config.json` jest jawnie wykluczony z listy `files`; do dystrybucji idzie tylko
`config.example.json`. Zweryfikowane na **obu** paczkach przez rozpakowanie
`app.asar` i przeszukanie plików — żadnego PIN-u tam nie ma.
(Grep po samym AppImage/instalatorze **nie jest** wiarygodnym testem: obrazy są
skompresowane, więc brak trafienia nic nie dowodzi.)

### Brak podpisu kodu
Pliki `.exe` nie są podpisane, więc Windows pokaże **SmartScreen** („Nieznany
wydawca"). To dotyczy każdego niepodpisanego instalatora, niezależnie od
technologii. Certyfikat kodu jest płatny — decyzja do podjęcia, jeśli program
ma być rozdawany szerzej.

### Cel `.deb`
Wyłączony domyślnie, bo wymaga adresu opiekuna pakietu, który w rozdawanym
pakiecie jest publiczny. Instrukcja włączenia jest w `electron-builder.yml`.

## Model uprawnień (sprawdzony)

Trzy niezależne poziomy — pomylenie ich prowadzi do cichych porażek:

1. **PIN jest wydawany per profil użytkownika**, nie per stacja ani per akcja.
   `GET ?action=PING` zwraca `operator` — to właśnie profil, do którego PIN należy.
2. **Logowanie przez API włącza się osobno dla użytkownika w danej akcji**
   (ustawienie w Managerze).
3. **PIN autoryzuje wyłącznie własny profil.** Wysyłka z `station_callsign` innego
   profilu kończy się `success:true` z **pustym `savedTo`** — QSO nie powstaje.

Potwierdzone testem: po włączeniu logowania przez API dla `SQ8BWA` w akcji, wysyłka
z `station_callsign: SQ8BWA` przy PIN-ie profilu `SQ8BWM` **nadal** zwracała
`savedTo:[]` (sprawdzone też po odczekaniu, więc to nie cache). Włączenie dostępu
dla danego użytkownika uprawnia **jego własny PIN**, a nie cudzy.

**Wniosek dla fan-outu:** wysyłka na N znaków stacji wymaga **N PIN-ów** — po jednym
z profilu każdej stacji, z włączonym logowaniem przez API w tej akcji. Dlatego przy
celu jest pole `pin`. Daemon sprawdza to na starcie i ostrzega, gdy cel ma inny znak
niż profil PIN-u, a własnego PIN-u nie podano.

## Fan-out: jedno QSO → kilka wpisów

To samo QSO z loggera można wysłać jako **kilka odrębnych łączności**, każdą z innym
znakiem stacji. Konfiguruje się to listą celów:

```json
"forward": {
  "operations": ["insert"],
  "targets": [
    { "station_callsign": "SN0ABC" },
    { "station_callsign": "SP0DEF", "operator": "SQ8BWM" },
    { "station_callsign": "3Z0GHI", "operator": "SP0OPER", "pin": "INNY-PIN" }
  ]
}
```

- **Pusta lista (domyślnie)** → jedno QSO ze znakiem stacji z loggera. Zero zmian.
- `station_callsign` — wymagany, **nadpisuje** znak podany przez logger.
- `operator` — opcjonalny. Bez niego zostaje operator z loggera. Celowo **nie**
  podstawiamy tu znaku stacji: to dwa różne pola.
- `pin` — **wymagany, gdy `station_callsign` należy do innego profilu niż PIN główny**
  (patrz „Model uprawnień"). Bez niego kopia wróci jako `NOT_SAVED`.

Pozostałe pola (data, czas, znak korespondenta, pasmo, emisja, raporty, `freq`,
komentarz) są w każdej kopii identyczne.

**Warunek konieczny:** każdy znak stacji musi mieć uprawnienia w aktywnej akcji.
To `station_callsign` decyduje, do której akcji trafi QSO (serwer zwraca listę
`savedTo`) — PIN jedynie autoryzuje. Znak bez uprawnień daje odpowiedź
`success:true` z **pustym** `savedTo`, czyli QSO nie zostaje zapisane; daemon
wykrywa to jako błąd `NOT_SAVED` i odkłada kopię do `data/failed/`.

Każda kopia jest osobnym elementem kolejki, więc ma własne ponowienia i własny
status — awaria jednej nie blokuje pozostałych.

> **Punktacja kopii.** Reguła duplikatu w akcji obejmuje znak stacji, więc kopie
> wysłane na różne stacje punktują się niezależnie — o to w fan-oucie chodzi.
> (Nie przeszło jeszcze testu end-to-end na dwóch stacjach, bo wymaga dwóch
> znaków uprawnionych w akcji.)
>
> **Fan-out na inny znak stacji wymaga własnego PIN-u** — patrz „Model uprawnień".
> Daemon ostrzega o tym na starcie, porównując znak celu z profilem PIN-u.

**Uwaga na przepustowość:** trzy cele to trzy żądania na jedno QSO, a limit wynosi
10/min. Przy trzech celach realna przepustowość to ok. 3 QSO/min; nadmiar czeka
w kolejce i jest dosyłany.

## Deduplikacja

Każde QSO ma klucz, po którym mostek rozpoznaje powtórki. Lista obsłużonych kluczy
(`data/seen.json`) przetrwa restart.

Klucz to **identyfikator z loggera + odcisk treści QSO**:

```
qlog:{logid}#{rowid}:{sha1(call|data|czas|pasmo|emisja|stacja)}
```

Odcisk jest tam **konieczny, nie ozdobny**. QLog podaje `rowid` z bazy SQLite, a taki
numer **jest ponownie używany po skasowaniu rekordu**. Klucz oparty na samym `rowid`
sprawiał, że nowe QSO z odzyskanym numerem znikało jako rzekomy duplikat — zdarzyło
się to realnie 2026-08-31 i kosztowało dwie łączności.

Sam odcisk treści też by nie wystarczył: ponowne zalogowanie tej samej łączności
w loggerze (naturalna reakcja operatora, gdy coś nie doszło) zostałoby wtedy
odrzucone, czyli droga ratunkowa przestałaby działać. Dlatego oba składniki naraz.

| Źródło | Identyfikator w kluczu |
|---|---|
| QLog | `{logid}#{rowid}` |
| N1MM | `<ID>` z XML |
| WSJT-X | brak (`noid`) — sam odcisk treści |

Do odcisku wchodzą tylko pola tożsamości łączności. Raporty, komentarz czy
częstotliwość **nie** — bywają poprawiane po fakcie, a to wciąż ta sama łączność.

Przy fan-oucie do klucza doklejany jest znak stacji celu (`…|SN0ABC`), inaczej trzy
kopie miałyby ten sam klucz i do kolejki weszłaby tylko pierwsza.

**Pominięcie jest widoczne w logu i liczone** (karta „Pominięte (duplikaty)").
Wcześniej leciało na poziomie `debug`, więc zgubione QSO wyglądało jak „nic nie
przyszło" — najgorszy możliwy tryb awarii.

## Log

Zdarzenia trafiają do konsoli, do bufora w pamięci (podgląd w zakładce **Log**)
oraz **do pliku** — `bridge.log` w katalogu danych, obok kolejki. Przycisk
„Pokaż plik logu" otwiera go w menedżerze plików; ta sama pozycja jest w menu
ikony w zasobniku.

Rotacja: po przekroczeniu `logFile.maxBytes` (domyślnie 5 MB) plik przechodzi na
`bridge.log.1`, starsze przesuwają się dalej, a najstarsze ponad `logFile.keep`
(domyślnie 3) jest usuwane.

Zapis jest **synchroniczny** i to świadoma decyzja: przy strumieniu asynchronicznym
ostatnie linie — czyli te najciekawsze przy awarii — ginęły razem z buforem przy
wyjściu z procesu. Log ma kilka linii na QSO, więc koszt jest bez znaczenia.

Wyłączenie: `"logFile": { "enabled": false }`.

## Zachowanie przy błędach## Zachowanie przy błędach
- **Brak sieci / 5xx / timeout** → ponawianie z backoffem (5 s, 10 s, 20 s, 40 s…
  do 15 min), do `queue.maxAttempts`. Przy domyślnych ustawieniach
  (`baseDelayMs: 5000`, `maxDelayMs: 900000`, `maxAttempts: 20`) daje to
  **około 3,4 godziny automatycznego ponawiania**. Po powrocie łączności QSO
  wysyłają się **same, bez żadnej ingerencji** — sprawdzone testem: awaria,
  trzy nieudane próby z narastającym odstępem, powrót serwera i automatyczny zapis.
  Dopiero po wyczerpaniu prób QSO idzie do `data/failed/` **bez** oznaczania jako
  obsłużone, więc `npm run requeue` (albo przycisk w UI) przywróci je do wysyłki.
  Chcesz przetrwać dłuższą awarię bez klikania — podnieś `maxAttempts`.
- **`DUPLICATE_QSO`** → traktowane jak sukces (wysyłka jest idempotentna).
- **Odpowiedź z kodem błędu** (np. `INVALID_CALLSIGN`, `INVALID_API_KEY`,
  `INVALID_QSO_DATA`) → błąd **trwały**: serwer odrzucił dane, więc wynik jest
  deterministyczny i ponawianie nic nie zmieni. QSO ląduje w `data/failed/`
  po jednej próbie. Klasyfikacja działa domyślnie „trwały", a nie po liście
  znanych kodów — dzięki temu nowy, nieznany kod błędu nie jest ponawiany godzinami.
  Wyjątek: kody i komunikaty wskazujące na limit tempa są traktowane jako przejściowe.
- **Nieznany format datagramu** → ostrzeżenie z podglądem pierwszych bajtów, proces żyje.

## Katalogi danych
```
data/queue/    QSO oczekujące na wysyłkę (jeden plik JSON = jedno QSO)
data/failed/   QSO odrzucone lub po wyczerpaniu prób
data/seen.json klucze już obsłużone (deduplikacja)
```
Zapis jest atomowy (`.tmp` + `rename`), więc ubicie procesu nie uszkodzi kolejki.

### Zajęty port UDP

Trzy różne sytuacje, często mylone:

| Kto zajmuje | Co się dzieje | Czy QSO dochodzą |
|---|---|---|
| **Port API** (12061) | ostrzeżenie w logu, daemon pracuje | **tak** |
| **Druga instancja mostka** na porcie UDP | blokada odmawia startu | nie temu procesowi — odbiera ta pierwsza |
| **Obcy program** na porcie UDP | mostek **startuje normalnie** | **tak, i to on je dostaje** |

Ten trzeci przypadek jest zaskakujący, więc został zmierzony: przy obcym programie
trzymającym już `127.0.0.1:12067` nasz mostek zbindował się obok i odebrał
**6 z 6** datagramów, a tamten program **0**.

Wynika to z `SO_REUSEADDR` przy transmisji **unicast**: kopii nie dostają wszyscy —
datagram trafia do jednego gniazda, w praktyce do tego, które zbindowało się
później. Inaczej jest przy **multicaście**, gdzie każdy słuchacz dostaje własną kopię
i współistnienie działa naprawdę.

Praktyczny wniosek: jeśli logger wysyła unicastem, a na tym samym porcie nasłuchuje
jeszcze inne narzędzie, **tylko jedno z nich dostanie QSO** — i nasz mostek może je
tamtemu odebrać. Gdy potrzebujesz obu naraz, użyj multicastu albo skonfiguruj logger
tak, żeby wysyłał na dwa różne porty.

### Dwie blokady chroniące przed drugą instancją

**Blokada portu UDP** — plik w katalogu tymczasowym systemu
(`/tmp/radiodyplom-bridge-udp-<host>-<port>.lock`). Bez niej dwa mostki
**zajęłyby ten sam port** i podzieliły między siebie datagramy: gniazda UDP
z `SO_REUSEADDR` na to pozwalają, a przydział jest nieprzewidywalny, więc część
QSO trafiałaby do niewłaściwej instancji i przepadała bez śladu. Sprawdzone —
drugi bind faktycznie przechodzi, dlatego pilnujemy tego sami:

```
Port UDP 127.0.0.1:12060 jest już używany przez proces 1017638.
Dwa mostki na jednym porcie dzieliłyby między siebie QSO, część by przepadła.
```

Blokada leży **poza** katalogiem danych celowo — inaczej dwie instancje z różnymi
`dataDir` wciąż walczyłyby o port.

**Blokada katalogu danych** — plik `.lock` z PID-em w katalogu danych. Druga
instancja mostka na tym samym katalogu **odmówi startu**:

```
Katalog danych jest już używany przez proces 12345 (…/data/.lock).
Uruchomienie dwóch mostków na jednej kolejce grozi wysłaniem QSO pod złą stację.
```

Nie jest to ostrożność teoretyczna: dwa daemony opróżniałyby tę samą kolejkę, więc
drugi mógłby wysłać QSO zakolejkowane przez pierwszego — **z własnym PIN-em, czyli
pod inną stację**. Dotyczy to np. jednoczesnego uruchomienia UI i usługi systemd.

Blokada po nieżyjącym procesie (twarde ubicie, restart maszyny) jest przejmowana
automatycznie. Jeśli świadomie chcesz dwie instancje, daj każdej własny `dataDir`.

## Struktura
```
src/index.js          spięcie całości, obsługa sygnałów
src/udp.js            nasłuch UDP + dyspozytor dekoderów
src/decoders/         qlog.js, n1mm.js, wsjtx.js + rejestr (index.js)
src/bands.js          częstotliwość → pasmo ADIF
src/modes.js          normalizacja emisji
src/mapper.js         pola znormalizowane → format radiodyplom
src/store.js          trwała kolejka plikowa
src/worker.js         retry, backoff, rate limit
src/radiodyplom.js    klient API
src/tools/            ping, queue-status, requeue, send-test
```

Dodanie kolejnego loggera = nowy plik w `src/decoders/` eksportujący
`name`, `detect(buf)` i `decode(buf, opts)`, dopisany do `DECODERS` w rejestrze.
Reszta pipeline'u nie wymaga zmian.

## Znane ograniczenia / do potwierdzenia
- `time_on` w formacie `HHMMSS` jest przyjmowany i zapisywany z dokładnością do
  sekundy — potwierdzone realnym uploadem (QSO id 996483, zapisany czas `09:20:44`).
  Nie trzeba obcinać czasu do `HHMM`.
- Pole `comment` trafia do formularza jako **„Klucz: (COMMENT)"**. Nie jest
  potwierdzone, czy radiodyplom traktuje je jako zwykłą notatkę, czy jako klucz
  dopasowania do warunków akcji. Świadoma decyzja: przekazujemy surowy komentarz
  z loggera bez zmian. Jeśli okaże się, że to pole ma znaczenie rozliczeniowe,
  trzeba je przestać wysyłać albo wypełniać wartością z konfiguracji.
- **Edycje i usunięcia QSO są nieprzekazywalne — to ograniczenie API, nie nasz wybór.**
  `qso_upload.php` udostępnia wyłącznie wysyłkę: GET obsługuje tylko `PING`/`STATUS`,
  a POST ignoruje pole `action` i zawsze waliduje żądanie jako nowe QSO
  (sprawdzone dla `DELETE`, `REMOVE`, `UPDATE`, `EDIT` — każde zwraca `INVALID_QSO_DATA`).
  Nie istnieje więc operacja usunięcia ani modyfikacji istniejącej łączności.

  Dlatego przekazywanie samych `insert` jest jedynym poprawnym zachowaniem, a nie
  uproszczeniem: gdybyśmy wysyłali też edycje, poprawienie w loggerze np. znaku
  korespondenta **utworzyłoby drugie QSO**, zostawiając błędne pierwsze na serwerze.
  Korekty i usunięcia trzeba robić ręcznie w Managerze.

  (Niezależnie od tego QLog przy edycji wysyła osobny komunikat na każde zmienione
  pole, a `contactreplace`/`contactdelete` z N1MM pomijamy.)
- Interfejs użytkownika w Electronie — kolejny etap; rdzeń jest bezstanowy wobec UI,
  logi i katalog `data/` są gotowym źródłem dla widoku statusu.
