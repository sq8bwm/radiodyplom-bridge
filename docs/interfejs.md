# Interfejs graficzny i API stanu

Okno aplikacji, praca w zasobniku, język oraz lokalne API dla podglądu stanu.

[← powrót do README](../README.md)


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

### Pytania zadaje własne okienko, nie natywne `confirm`

Wszystkie potwierdzenia (zapis mimo braku uprawnień, usunięcie PIN-u celu,
ponowienie w trybie próbnym, usunięcie odrzuconych, zakończenie programu)
rysuje **sama strona**. Escape i kliknięcie w tło anulują, ognisko wraca do pola,
z którego przyszło pytanie, a przyciski są przetłumaczone.

Powód nie jest kosmetyczny. Natywne, blokujące `window.confirm` w Electronie
na Linuksie po zamknięciu **nie oddawało ogniska klawiatury** rendererowi:
kliknięcia działały dalej, ale w żadnym polu nie dało się nic wpisać — okno
stawało się bezużyteczne. Odtworzone 2026-09-04 na ścieżce: dodaj cel bez
uprawnień → Zapisz → Anuluj → dopisz cokolwiek. Przywracanie ogniska z kodu
byłoby łataniem objawu, więc natywnych okienek nie używamy wcale.

### Karty liczbowe — co która liczy i za jaki czas

Każda karta ma drugą linię i podpowiedź pod kursorem, bo bez nich mieszały się
trzy różne rzeczy: licznik trwały z licznikiem procesu, kopie z QSO, oraz
wysyłka prawdziwa z próbną.

| Karta | Liczba główna | Druga linia |
|---|---|---|
| WYSŁANE | **kopie** wysłane od początku (trwałe) | `w tej sesji: N kopii`, plus duplikaty i przejścia próbne tej sesji, jeśli były |
| W KOLEJCE | oczekujące | `na dysku, przeżywa restart` |
| ODRZUCONE | odrzucone przez serwis | `na dysku, przeżywa restart` |
| ODEBRANE Z LOGGERA | **QSO** przyjęte w tej sesji | `datagramów: R · nieodczytane: N` |
| POMINIĘTE (DUPLIKATY) | deduplikacja | `w tej sesji` |

**Przejścia próbne nie wchodzą do „wysłanych"** — ani do licznika trwałego, ani
do sesyjnego. QSO, które nie opuściło komputera, nie jest wysłane. Liczba
przejść próbnych od początku jest w podpowiedzi karty.

Panel **ŹRÓDŁA** pokazuje pod dekoderami wiersz `bez QSO`, z podziałem na
nieznany format, brak wymaganych pól i świadome pominięcie — a pod nim
**wypisuje powody z liczbami**, na przykład:

```
bez QSO: 4  (nieznany format: 0 · brak wymaganych pól: 0 · pominięte świadomie: 4)
    operacja "update": 3
    operacja "delete": 1
```

Najczęstszy powód to **edycja albo usunięcie QSO w loggerze**: QLog wysyła
datagram przy każdej operacji w dzienniku, a mostek przekazuje wyłącznie
`insert` (`forward.operations`). Ponowne wysłanie poprawionego QSO i tak byłoby
duplikatem — radiodyplom nie ma czego „poprawiać".

**Uwaga na mnożnik:** licznik pokazuje **datagramy**, a jedna poprawka QSO
w QLogu wysyła ich **dwa** (zmierzone). Cztery pominięcia to więc dwie Twoje
edycje, nie cztery. Okno mówi o tym wprost pod listą powodów.

Powody są **zliczane, a nie logowane** na poziomie `info`: WSJT-X nadaje
komunikaty stanu co sekundę i zalałby log. Wcześniej trafiały tylko do `debug`,
więc przy domyślnych ustawieniach nie dało się odpowiedzieć na pytanie „skąd
te cztery pominięte".

### Powiadomienie o nowszej wersji

Program **nie aktualizuje się sam** — sprawdza tylko, czy na GitHubie jest
nowsze wydanie, i mówi o tym: odznaką w nagłówku (klik → zakładka „O programie")
oraz wierszem przy numerze wersji, z przyciskiem prowadzącym do wydania.

Dlaczego bez samoaktualizacji — trzy powody, w tej kolejności:

1. **Mostek pracuje w trakcie akcji.** Aktualizator, który się restartuje,
   przerywa nasłuch UDP, a QSO wysłane przez logger w tym oknie **nie ma jak
   wrócić** — UDP nie ponawia. Program gubiący łączności, żeby się
   zaktualizować, jest gorszy od nieaktualnego.
2. **Samoaktualizacja objęłaby dwie postacie z czterech.** `latest.yml`
   generowany przez electron-buildera opisuje wyłącznie instalator NSIS,
   a `latest-linux.yml` wyłącznie AppImage. `.deb` i wersja przenośna i tak
   potrzebowałyby powiadomienia — czyli tego, co jest.
3. Instalatorów nie podpisujemy, więc pobrana aktualizacja i tak trafiłaby na
   ostrzeżenie SmartScreen.

Sprawdzenie idzie do `api.github.com` na starcie i raz na dobę. **Da się je
wyłączyć** — to wychodzenie na zewnątrz, a nie każdy pracuje z łącza bez limitu:

```json
"updates": { "check": false }
```

Brak łączności jest **cichy**: żadnego czerwonego stanu, żadnego wpisu w logu
powyżej `debug`. Wpis pojawia się tylko wtedy, gdy nowsza wersja naprawdę jest.

### Panel „Konto na radiodyplom.pl"

Na zakładce **Stan**, z odpowiedzi `PING`. Pokazuje, czym konto naprawdę
dysponuje: operatora, **znaki stacji, na które wolno logować**, i **aktywne akcje**
z zakresem dat. To odpowiedź na najczęstsze „dlaczego moje QSO się nie zapisało":
albo znaku stacji nie ma na liście, albo żadna akcja w tej chwili nie trwa.

Rozróżnia dwa różne braki:

- *serwis nie podaje* — starsza wersja API, nic nie wiemy;
- *brak — konto nie ma przypisanej żadnej stacji* — serwis odpowiedział i wiemy,
  że nie ma nic.

### Znacznik uprawnień przy regule fan-outu

Każdy wiersz w „Rozmnażanie QSO na wiele stacji" ma znacznik, z podpowiedzią
pod kursorem:

| Znacznik | Znaczenie |
|---|---|
| zielone `✓` | konto ma tę stację na liście — kopie się zapiszą |
| żółta `•` | uprawnienia są, ale konto nie ma teraz aktywnej akcji |
| czerwone `!` | serwis kopii **nie przyjmie** (brak stacji, zły PIN, wyłączone API) |
| szare | to samo, ale reguła jest wyłączona — nic nie wysyła, więc nie jest pilne |
| brak | nie wiadomo: brak łączności, starszy serwis albo reguła dopiero wpisywana |

Znacznik jest **trwały** — nie gaśnie sam po chwili. Ostrzeżenie, które znika,
jest gorsze od żadnego.

Przy **zapisie** okno pyta, jeśli któraś włączona reguła nie przejdzie, i wymienia
stacje. **Zapisu nie blokuje**: dane bywają nieaktualne o minutę, serwis może nie
odpowiedzieć, a „wpiszę regułę teraz, stację dopiszę wieczorem" to normalna
kolejność pracy. Szczegóły w [konfiguracja.md](konfiguracja.md).

### Język
Przełącznik **Polski / English** w nagłówku okna. Wybór zapamiętywany w konfiguracji
(`language`), więc obowiązuje też dla menu i podpowiedzi w zasobniku oraz po restarcie.
Tłumaczenia siedzą w jednym słowniku `ui/strings.js` — bez żadnej biblioteki.

Komunikaty błędów z API przychodzą **po polsku z serwera**, dlatego przy angielskim
interfejsie tłumaczymy je **po kodzie** (`INVALID_CALLSIGN`, `NOT_SAVED`,
`INVALID_API_KEY`…), a treść serwera zostaje w nawiasie jako uzupełnienie.

Pięć zakładek:
- **Stan** — liczniki, adres nasłuchu, rozbicie na źródła (QLog / N1MM / WSJT-X)
  i **lista ostatnich zdarzeń**: co wysłane, co duplikat, co ponawiane, a co
  odrzucone. Wiersze z problemem są **czerwone**, ponowienia żółte, duplikaty
  wyblakłe. Ile wierszy pokazywać, ustawia się w Konfiguracji (5–200,
  domyślnie 20); bufor w rdzeniu trzyma 200, więc podniesienie liczby pokazuje
  historię od razu, a nie zaczyna zbierania od nowa.
- **Kolejka** — co czeka i co zostało odrzucone: znak, stacja, **operator**, liczba prób,
  powód. Operator jest tu istotny przy rozmnażaniu QSO: dwie kopie tej samej łączności
  różnią się stacją *i* operatorem, więc bez tej kolumny nie odróżnisz ich od siebie.
- **Konfiguracja** — PIN, tryb próbny, adres i port nasłuchu, grupy multicast,
  liczba pokazywanych zdarzeń, cele rozmnażania QSO.
- **Log** — bieżące zdarzenia. Pole zajmuje całą wysokość okna (liczoną
  z faktycznego położenia, więc zawinięcie nagłówka nic nie psuje) i przewija
  się **samo**, nie razem ze stroną. Widok skacze za nowymi wpisami tylko
  wtedy, gdy jest już na końcu logu; po przewinięciu w górę zostaje na miejscu,
  a pasek nad logiem mówi „przewinięte w górę" i pokazuje przycisk „Na koniec".
  Długie ładunki JSON są łamane, więc nie ma przewijania w bok.
- **O programie** — wersja, autor, licencja i zdanie o braku gwarancji, plus
  odnośniki do pełnego tekstu licencji, repozytorium i wydań.

Zakładka „O programie" **nie ma niczego wpisanego na sztywno** — wersję, autora,
licencję i adres repozytorium bierze z `/api/status`, czyli z `package.json`.
Bez tego numer wersji w oknie rozjechałby się z nazwą pliku instalatora przy
pierwszym ręcznym podniesieniu wersji. Adres e-mail autora jest świadomie
pomijany: w oknie nie jest potrzebny, a w metadanych `.deb` i tak jest.

Odnośniki otwierają się w **przeglądarce systemowej**, przez IPC `openUrl`,
nie w oknie aplikacji. Uchwyt w procesie głównym przepuszcza wyłącznie adresy
`https://` — `shell.openExternal` wykonałby też `file:` czy `mailto:`.

### Tryb próbny a deduplikacja

W trybie próbnym wiersz zdarzenia mówi **„próbnie — NIE wysłane"**, a licznik
zmienia etykietę na **„Wysłane (próbnie)"**. Wcześniej pisał „wysłane" bez
numeru akcji, co przy QSO, które nigdy nie opuściło komputera, było zwykłym
kłamstwem.

Rzecz, o której trzeba wiedzieć: QSO przepuszczone próbnie zostaje **zamknięte
w deduplikacji** i **nie poleci** po wyłączeniu trybu próbnego. Tryb próbny
służy do sprawdzenia mapowania pól, nie do przechowywania QSO na później —
do tego jest przycisk **„Wstrzymaj"**, który trzyma je w kolejce. Podpowiedź
z tym ostrzeżeniem wisi na plakietce DRY-RUN.

### Sygnalizacja problemów

Gdy QSO **nie trafi na serwer** — odrzucone trwale albo porzucone po wyczerpaniu
prób — w nagłówku, obok plakietki DRY-RUN, zapala się czerwone **„PROBLEMY: n"**.

Rzecz istotna, bo pierwsza wersja robiła to **źle**: liczba nie jest licznikiem
w pamięci, a **różnicą** między zawartością `data/failed/` i trwale zapisanym
poziomem potwierdzenia (pole `ackedFailed` w `seen.json`).

Licznik w pamięci nie miał sensu: w spakowanej aplikacji rdzeń żyje w tym samym
procesie co okno, więc zamknięcie programu kasowało sygnalizację, choć odrzucone
QSO zostawały na dysku. Plakietka znikała, a problem trwał. Teraz przeżywa
restart — i potwierdzenie też.

Kliknięcie plakietki prowadzi na zakładkę **Kolejka**, gdzie stoją wszystkie
trzy przyciski: ponowienie, wyczyszczenie sygnalizacji i usunięcie odrzuconych
(patrz [Kolejka i log](kolejka.md)). Sama plakietka niczego nie kasuje —
w nagłówku obok stoi „Zakończ", więc nie może tam być akcji działającej
od jednego kliknięcia.

Poziom potwierdzenia jest przycinany w dół, gdy `failed/` się opróżni — po
„Ponów odrzucone" albo po ręcznym sprzątnięciu katalogu. Bez tego arytmetyka
przemilczałaby następne odrzucenie (potwierdzone 4, potem 1 nowe → 1−4 = 0).

Zwykłe ponowienia **nie** zapalają plakietki — naprawiają się same, a inaczej
świeciłaby przy każdym mignięciu sieci.

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
| GET | `/api/stats` | statystyki z dziennika wysłanych, z zakresem dat i zawężeniem po operatorze/stacji |
| POST | `/api/config/check` | ocenia cele z konfiguracji **niezapisanej** (ciało: taki sam obiekt jak przy zapisie) |

Dwie decyzje projektowe, świadome i celowe:

> **Serwer nasłuchuje wyłącznie na `127.0.0.1`** — niezależnie od `udp.host`. To jest
> interfejs *sterujący* wysyłką QSO na Twoim PIN-ie; wystawienie go na sieć oddałoby
> obcym kontrolę nad Twoim logiem.

> **PIN-y nigdy nie opuszczają procesu.** W `/api/status` są zamaskowane (`ABCD-****`),
> tak samo PIN-y celów fan-outu. UI nie potrzebuje ich w jawnej postaci.

> **Sprawdzanie nigdy nie zwraca piątki.** `/api/config/check` przy błędzie oddaje
> `200` z `ok:false` i pustą listą ocen. Gdyby padało błędem, okno musiałoby
> zgadywać, czy zapis wolno wykonać — a wolno **zawsze**.

Z cudzych kont `/api/status` podaje przy regule tylko `state`, `blocking` i znak
operatora — nigdy listy stacji. Listy stacji widać wyłącznie dla konta głównego,
w panelu „Konto na radiodyplom.pl".

Jeśli **port API** (12061) jest zajęty, daemon loguje ostrzeżenie i pracuje dalej —
brak podglądu nigdy nie może zatrzymać przekazywania QSO. Sprawdzone: przy zajętym
12061 QSO z loggera nadal przechodzi.

To dotyczy **wyłącznie portu API**. Port UDP, na którym słucha logger, to osobna
sprawa — patrz „Zajęty port UDP" niżej.

`queue.pending` / `queue.failed` / `queue.sent` to **liczniki**, a `pendingItems`
i `failedItems` to listy przycięte do 50 pozycji — nie myl ich przy budowie UI.
