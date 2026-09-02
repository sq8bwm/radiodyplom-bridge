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

### Zakładka „O programie"
Na jutro (zgłoszone 2026-09-02). Piąta zakładka obok Stan / Kolejka /
Konfiguracja / Log, z: **wersją**, **autorem** i **licencją**.

Do rozstrzygnięcia przy robocie, żeby nie zgadywać na miejscu:
- **Skąd wersja.** `package.json` nie wchodzi do paczki jako plik do czytania
  w czasie działania — wchodzi do `app.asar`. W procesie głównym jest
  `app.getVersion()`, ale renderer go nie widzi. Najprościej: dodać wersję
  do `/api/status` (rdzeń zna ją z `package.json`) albo przez IPC w preload.
  **Ta sama liczba musi zgadzać się z nazwą pliku instalatora** — inaczej
  zakładka będzie kłamać po ręcznym podniesieniu wersji.
- **Autor i licencja** są w `package.json` (`author`, `license: GPL-3.0-or-later`).
  Nie wpisywać ich drugi raz na sztywno w UI. Zakładka ma podać wersję licencji
  i **zdanie o braku gwarancji** — dla GPL to właściwe miejsce w programie
  z interfejsem graficznym. Warto dać odnośnik do pełnego tekstu (`LICENSE`
  jest w paczce: w AppImage w katalogu głównym, w `.deb` obok aplikacji).
- Teksty przez `ui/strings.js` w obu językach, jak resztę interfejsu.
- Warto dołożyć odnośnik do repozytorium i do wydań — przy braku
  automatycznych aktualizacji to jedyna droga, żeby użytkownik sprawdził,
  czy ma najnowszą wersję.

### Nagłówki licencyjne w plikach źródłowych
Do rozważenia po zmianie na GPL. Zalecana praktyka GNU to krótki nagłówek
w każdym pliku (kto, jaka licencja, brak gwarancji). U nas to 25 plików,
z których każdy zaczyna się już blokiem komentarza wyjaśniającego — więc
zmiana jest mechaniczna, ale hałaśliwa w diffie. Sama licencja obowiązuje
bez tych nagłówków; to kwestia wygody kogoś, kto dostanie jeden plik
w oderwaniu od repozytorium.

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
