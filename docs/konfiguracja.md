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
| `radiodyplom.pin` | PIN/klucz API akcji dyplomowej (profil główny) |
| `operators` | baza znak → PIN API, do wyboru w celach rozmnażania |
| `radiodyplom.dryRun` | `true` = nic nie wysyła, tylko loguje (do testów) |
| `udp.port` | port nasłuchu (musi zgadzać się z loggerem) |
| `forward.operations` | które operacje QLog przekazywać (domyślnie `["insert"]`) |
| `forward.targets[].operator` | znak z `operators`: pole OPERATOR i PIN tej kopii |
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
z profilu każdej stacji, z włączonym logowaniem przez API w tej akcji. Dlatego jest
baza `operators`, a cel wskazuje osobę polem `operator` (patrz [Rozmnażanie QSO](fan-out.md)).
Daemon sprawdza to na starcie i ostrzega, gdy cel ma inny znak niż profil PIN-u,
a żadnego własnego PIN-u nie wskazano.
