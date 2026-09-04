# Rozwój i pakowanie

Wymagania środowiska, testy, struktura kodu, budowanie paczek i dystrybucja.

[← powrót do README](../README.md)


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


### Testy w CI

`.github/workflows/testy.yml` — na każdym pull requeście i wypchnięciu do `main`.
Przebieg zajmuje **około 30 sekund**, bo pomijamy ściąganie binarki Electrona
(`ELECTRON_SKIP_BINARY_DOWNLOAD`): żaden test jej nie potrzebuje, a to ~100 MB
i większość czasu. `desktop-entry.test.js` czyta `electron-builder.yml` tylko
jako plik, przez `js-yaml`.

Token przebiegu ma `contents: read` i nic więcej. Kolejny przebieg tej samej
gałęzi anuluje poprzedni — przy kilku poprawkach z rzędu liczy się ostatni.

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

### Sprawdzenie wydania po wgraniu — bez ściągania 440 MB

Po utworzeniu wydania warto potwierdzić, że GitHub ma dokładnie te pliki, które
zbudowaliśmy. Pobieranie wszystkich załączników do tego celu jest kosztowne
i **zawodne** — przy zerwaniu łączności pobiera się plik ucięty i sumy nie
pasują, co wygląda jak zepsute wydanie, a jest tylko przerwanym transferem
(zdarzyło się 2026-09-04 przy 0.1.10).

GitHub podaje sumę `sha256` **każdego załącznika** w API, więc rozstrzyga to
jedno żądanie:

```bash
gh api repos/<user>/<repo>/releases/tags/<tag> \
  --jq '.assets[] | "\(.digest)  \(.name)  \(.size)"'
```

Zwrócone `sha256:…` porównujemy z `release/SHA256SUMS`, a rozmiary z plikami
lokalnymi. Zgodność jednego i drugiego znaczy, że odbiorca dostanie to samo,
co zbudowaliśmy — i nie trzeba niczego pobierać.

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


## Praca nad kodem z zewnątrz

Repozytorium jest publiczne, więc **pull requesty są mile widziane** — zwłaszcza
nowe dekodery loggerów (jeden plik w `src/decoders/`, patrz `loggery.md`).

`main` jest chroniony i **wymaga pull requesta**; wymuszone wypchnięcia
i usunięcie gałęzi są zablokowane dla wszystkich, także dla właściciela.
Bezpośrednio do `main` pisze tylko właściciel repozytorium.

**Testy uruchamiają się automatycznie na każdym pull requeście** i ich zielony
wynik jest **wymagany do scalenia** — czerwony przebieg blokuje merge (stan
`BLOCKED`, GitHub odmawia: *„the base branch policy prohibits the merge"*).
Ustawiona jest też opcja `strict`, więc gałąź musi mieć najnowszy `main`, żeby
testy przechodziły na tym, co faktycznie wejdzie.

Sprawdzone końcowo na PR #1: z zepsutym testem scalenie odrzucone, po jego
usunięciu stan `CLEAN` i scalenie przeszło zwykłą drogą, bez uprawnień
administratora.

Czego oczekuję od zgłoszenia:

- **testy przechodzą** (`npm test`) i nowe zachowanie ma swój test — najlepiej
  taki, który opisuje, *co* by się zepsuło bez niego;
- **zero zależności runtime.** Program ma ich nie mieć i to jest świadoma
  decyzja (patrz „Wymagania");
- komentarz tam, gdzie kod robi coś nieoczywistego — dlaczego, nie co;
- **żadnych sekretów.** `config.json`, `data/` i `*.log` są ignorowane, bo log
  mostka potrafi zawierać PIN-y celów. Przed wysłaniem warto to sprawdzić.

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
