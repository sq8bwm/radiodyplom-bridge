# Konfiguracja

Wszystkie opcje pliku konfiguracyjnego, co działa od razu, a co wymaga restartu, oraz gdzie trzymane są dane.

[← powrót do README](../README.md)


## Konfiguracja daemona
```bash
cp config.example.json config.json   # config.json jest w .gitignore
```
W `config.json` wstaw PIN API z Managera radiodyplom
(*Dostęp API → Generuj nowy PIN API → Zapisz PIN API*). Alternatywnie zmienna
środowiskowa `RD_PIN` nadpisuje wartość z pliku.

| Opcja | Znaczenie |
|---|---|
| `radiodyplom.pin` | PIN/klucz API konta w radiodyplom |
| `radiodyplom.dryRun` | `true` = nic nie wysyła, tylko loguje (do testów) |
| `udp.port` | port nasłuchu (musi zgadzać się z loggerem) |
| `forward.operations` | które operacje QLog przekazywać (domyślnie `["insert"]`) |
| `forward.targets[].operator` | pole OPERATOR tej kopii (dane, serwer go nie sprawdza) |
| `queue.maxAttempts` | ile prób przed odłożeniem do `data/failed/` |
| `rateLimit.maxPerMinute` | limit wysyłek (API dopuszcza 10/min, trzymamy 9) |


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


## Model uprawnień (zmierzony 2026-09-02)

Rozstrzygnięte pomiarem na prawdziwym serwerze, po wcześniejszym **błędnym**
wniosku — dlatego szczegóły są tu zapisane wprost.

**PIN API to konto**, a konto ma w Managerze **listę znaków stacji**, na które
wolno mu logować (plus przełączniki: logowanie z zewnątrz przez API, logger
online, wgrywanie ADIF). Jedno konto może mieć wiele stacji; bywa też
uprawnienie „Wszystkie stacje".

Z tego wynikają dwie rzeczy, obie sprawdzone:

| Pole | Czy serwer je sprawdza |
|---|---|
| `station_callsign` | **tak** — musi być na liście stacji konta, do którego należy PIN |
| `operator` | **nie** — nie jest w ogóle weryfikowane |

Pomiar, przy PIN-ie konta `SQ8BWM` i stacji `SQ8BWM` (na liście):

| Wysłane | Odpowiedź |
|---|---|
| `operator=SQ8BWM` (właściciel konta) | `savedTo [295]` |
| `operator=SQ8BWA` (inna, istniejąca osoba) | `savedTo [295]` |
| `operator=SP9ZZZ` (znak nieistniejący) | `savedTo [295]` |
| `station_callsign=SQ8BWA` (poza listą konta) | `savedTo []` |
| `station_callsign=SP9ZZZ` (znak nieistniejący) | `savedTo []` |

Komunikat przy `savedTo:[]` jest jednoznaczny: *„QSO odebrane, ale w tym momencie
brak aktywnych akcji dyplomowych i uprawnień dla podanego znaku."* Daemon
rozpoznaje to jako trwały błąd `NOT_SAVED` i odkłada QSO do `data/failed/`.

**Wniosek dla fan-outu: wystarczy JEDEN PIN.** Rozmnażanie na kilka znaków
stacji nie wymaga kilku PIN-ów — wymaga, żeby te znaki były na liście stacji
Twojego konta. Dodanie tam stacji jest zmianą w Managerze, nie w tym programie.

> Wcześniejsza wersja tej dokumentacji twierdziła, że „wysyłka na N znaków
> stacji wymaga N PIN-ów". To był zły wniosek z jednego pomiaru: `SQ8BWA` nie
> działało nie dlatego, że potrzebny był cudzy PIN, ale dlatego, że tego znaku
> nie było na liście stacji konta. Program przez chwilę miał z tego powodu bazę
> operatorów z osobnymi PIN-ami — została usunięta jako niepotrzebna.

Pole `pin` przy celu fan-outu (droga z 0.1.x) nadal działa i pozwala wysłać kopię
z innego konta. Nie ma go w interfejsie i przy jednym koncie z listą stacji nie
jest potrzebne.
