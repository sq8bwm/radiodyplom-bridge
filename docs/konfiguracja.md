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
| `forward.targets[].operator` | pole OPERATOR tej kopii (sprawdzane tylko jako znak; >15 znaków ucinane) |
| `forward.targets[].pin` | PIN konta, z którego leci ta kopia (brak = PIN główny) |
| `forward.targets[].enabled` | `false` wyłącza regułę bez usuwania danych (domyślnie `true`) |
| `queue.maxAttempts` | ile prób przed odłożeniem do `data/failed/` |
| `rateLimit.maxPerMinute` | limit wysyłek (API dopuszcza 10/min, trzymamy 9) |
| `ui.recentEvents` | ile ostatnich zdarzeń pokazuje zakładka Stan (5–200, domyślnie 20) |
| `updates.check` | czy sprawdzać, że jest nowsze wydanie (domyślnie `true`) |
| `updates.intervalHours` | co ile godzin sprawdzać (domyślnie 24, minimum 1) |
| `api.host` | adres nasłuchu interfejsu (domyślnie `127.0.0.1`; `0.0.0.0` = sieć lokalna) |
| `api.port` | port interfejsu (domyślnie 12061; ten sam przy HTTP i HTTPS) |
| `api.readOnly` | `true` blokuje wszystkie zmiany przez interfejs; brak = domyślnie, czyli tylko odczyt w sieci |
| `api.auth.passwordHash` | hasz hasła do interfejsu (`scrypt$…`); ustawia się z okna albo poleceniem — patrz niżej |
| `RD_API_PASSWORD_HASH` | ten sam hasz ze **zmiennej środowiskowej**; ma pierwszeństwo nad plikiem i nie jest do niego przepisywany. Na maszynie bez pulpitu to właściwe miejsce: `pin.env` ma prawa `0640`, a `config.json` — `0644` |
| `api.tls.enabled` | HTTPS (domyślnie `true`); wyłączenie blokuje nasłuch w sieci |
| `api.tls.certFile` / `keyFile` | własny certyfikat; brak = program wystawia sobie sam |

**Nasłuch w sieci wymaga hasła ORAZ HTTPS jednocześnie.** Bez jednego z nich
program zostaje na `127.0.0.1` i wypisuje powód w logu — świadomie, bo otwarty
port bez hasła oddaje sterowanie wysyłką QSO. Zmiana `api.host`, `api.readOnly`
i `api.tls.enabled` wymaga **restartu**. Opis, ryzyka i przepis na certyfikat:
[interfejs-w-sieci.md](interfejs-w-sieci.md).


## Zgłaszanie błędów — czego NIE wysyłać

`config.json` w wersji z pulpitem zawiera **jawny PIN API** (a od 0.1.15 także
hasz hasła do interfejsu). Nie wysyłaj tego pliku i nie wklejaj go na forum ani
do zgłoszenia.

Zamiast tego program potrafi zapisać **zgłoszenie bez sekretów**:

- **w oknie:** zakładka *O programie* → **Zapisz zgłoszenie do wysłania**,
  albo menu ikony w zasobniku → *Zapisz zgłoszenie…*
- **na maszynie bez pulpitu:**

  ```bash
  cd /usr/lib/radiodyplom-bridge && node src/tools/zgloszenie.js ~
  ```

  (z katalogu z kodem: `npm run report`)

Powstaje plik `radiodyplom-zgloszenie-<data>.json` z prawami `0600`, a w nim:
wersja i system, konfiguracja z **zamaskowanymi** PIN-ami (`AB**-****`) i bez
hasła, stan kolejki i nasłuchu oraz **200 ostatnich wpisów logu**.

Sekrety są usuwane dwiema niezależnymi drogami: plik powstaje z tej samej
zamaskowanej postaci, którą widzi okno, a na koniec gotowy wynik jest jeszcze
przeszukiwany pod kątem prawdziwych wartości. Druga warstwa istnieje dlatego,
że pierwsza opiera się na poprawności wszystkich ścieżek — a ta działa nawet
wtedy, gdy któraś przestanie być poprawna.

Plik zawiera znaki korespondentów z logu i nazwę maszyny. Nie są to sekrety,
ale warto o tym wiedzieć, wysyłając go na publiczne forum.

## Katalogi danych
```
data/queue/    QSO oczekujące na wysyłkę (jeden plik JSON = jedno QSO)
data/failed/   QSO odrzucone lub po wyczerpaniu prób
data/seen.json klucze już obsłużone (deduplikacja)
```
Zapis jest atomowy (`.tmp` + `rename`), więc ubicie procesu nie uszkodzi kolejki.

### Portable i AppImage: dane obok pliku programu

Domyślnie **każda** wersja z okienkiem trzyma dane w katalogu użytkownika:

| System | Konfiguracja | Dane (`dataDir: "auto"`) |
|---|---|---|
| Windows | `%APPDATA%\radiodyplom-bridge` | `%APPDATA%\radiodyplom-bridge\data` |
| Linux | `~/.config/radiodyplom-bridge` | `~/.local/share/radiodyplom-bridge/data` |

Znaczy to, że **portable dzieli wszystko z wersją instalowaną** (a AppImage
z paczką `.deb`): ten sam PIN, tę samą kolejkę, ten sam certyfikat i tę samą
blokadę — więc obie nie uruchomią się obok siebie, a na cudzym komputerze
portable zostawia w profilu jawny PIN.

Od 0.1.22 da się to zmienić, **na życzenie**: utwórz obok pliku programu katalog

```
radiodyplom-dane
```

Sama jego obecność przenosi tam konfigurację **i** dane. Nie ma katalogu —
wszystko działa jak dotąd, więc zwykła aktualizacja nikomu nic nie przenosi.
Zakładka *O programie* pokazuje wtedy „portable · dane obok pliku programu",
a w logu jest linia `Dane obok pliku programu: …`. Katalog tylko do odczytu
(zablokowany pendrive) nie jest udawany: program wraca do domyślnego katalogu
i mówi o tym w logu.

Po co to komu:

- **pendrive** — konfiguracja, PIN i kolejka jadą z plikiem, a na obcym
  komputerze nie zostaje nic;
- **dwie instancje naraz** — patrz niżej.

### Dwie instancje na jednej maszynie

Sensowne, gdy jedna obsługuje logger lokalny, a druga akcję dyplomową. Trzeba
dać drugiej instancji **osobne dane i osobne porty** — inaczej zatrzyma ją
jedna z dwóch blokad opisanych niżej:

1. utwórz `radiodyplom-dane` obok pliku portable (albo AppImage'a),
2. w `radiodyplom-dane/config.json` ustaw inne porty, na przykład
   `udp.port: 12070` i `api.port: 12071`.

Sprawdzone na uruchomionym programie: wersja instalowana na `12060/12061`
i portable na `12070/12071` pracują jednocześnie, każda z własną kolejką.

**Bez katalogu `radiodyplom-dane` druga wersja się nie uruchomi** — pokaże się
okno tej, która już działa. Wygląda to tak, jakby kliknięty plik nie działał,
więc od 0.1.23 program **pyta**, co zrobić:

- *Pracuj dalej na działającej* — zachowanie jak dotąd,
- *Załóż katalog i uruchom obok* — program sam tworzy `radiodyplom-dane` obok
  klikniętego pliku, **dobiera wolne porty** (pierwsza wolna para od 12070:
  UDP i o jeden wyżej interfejs) i uruchamia tę wersję ponownie, już na własnym
  katalogu.

Nowa instancja ma **własną, świeżą konfigurację**: tryb próbny i bez PIN-u —
PIN-u nie kopiujemy, bo katalog bywa na pendrivie albo na dysku współdzielonym.
Trzeba go wpisać w jej zakładce Konfiguracja, a logger, który ma do niej
trafiać, musi wysyłać na jej port UDP.

Gdy obok pliku nie da się zapisywać (`/opt`, *Program Files*, nośnik tylko do
odczytu), program to mówi wprost, zamiast po cichu nie zrobić nic.

Powód całej tej sytuacji jest w blokadzie jednej instancji Electrona (niżej,
„trzecia blokada").

**O czym pamiętać:** deduplikacja jest osobna dla każdej instancji, więc gdyby
logger wysyłał to samo QSO na oba porty, poleciałoby **dwa razy**. Kolejka też
jest osobna — QSO czekające w jednej instancji nie zostanie wysłane przez drugą.

Bez okienka to samo robi zmienna `RD_DATA_DIR` (dane) razem
z `RD_CONFIG_DIR` (konfiguracja).

### Porty przy pierwszym uruchomieniu

Świeża konfiguracja powstaje z szablonu, czyli z portami **12060** (logger)
i **12061** (interfejs). Gdyby na maszynie działała już inna instancja mostka,
nowa padłaby od razu na blokadzie portu UDP — pierwsze uruchomienie po
instalacji kończyłoby się czerwonym banerem awarii.

Dlatego przy **zasiewie konfiguracji** program sprawdza, czy domyślne porty są
wolne, a jeśli nie — bierze pierwszą wolną parę od 12070 (dziesiątkami: 12070,
12080…) i wpisuje ją do `config.json`. Zakładka *Stan* mówi wtedy wprost, że
port jest inny niż domyślny, bo logger trzeba ustawić właśnie na niego.

Dwa świadome ograniczenia:

- **Tylko przy zasiewie.** Później porty są decyzją użytkownika; cicha zmiana
  przy każdym starcie zepsułaby działającą konfigurację loggera.
- **Tylko wersje z okienkiem.** Usługa bez interfejsu dostaje `config.json`
  z pakietu (`postinst`) i portów jej nie ruszamy: nikt nie patrzy wtedy
  w okno, a usługa nasłuchująca po cichu gdzie indziej niż mówi dokumentacja
  byłaby gorsza od usługi, która wprost odmawia startu i pisze powód
  w `journalctl`.

Sonda sprawdzająca port **nie może** używać `SO_REUSEADDR` — nasz mostek
binduje z tą opcją (potrzebna do multicastu), więc sonda ustawiająca ją też
zbindowałaby się obok i uznała zajęty port za wolny. Zmierzone: z `reuseAddr`
wychodzi „wolny", bez niej `EADDRINUSE`.

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
automatycznie. Jeśli świadomie chcesz dwie instancje, daj każdej własny `dataDir`
i własne porty — przepis wyżej, w „Dwie instancje na jednej maszynie".

**Trzecia blokada, nie nasza:** Electron pozwala na jedno okno na jeden katalog
`userData`. Druga instancja tylko pokazuje okno pierwszej i kończy pracę. Dlatego
katalog danych obok pliku ustawiamy **przed** pobraniem tej blokady — bez tego
osobne porty i osobny `dataDir` nic by nie dały.


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
| `operator` | **tylko jako znak** — dowolny poprawny callsign przechodzi, z żadną listą nie jest wiązany |

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

Pole `pin` przy celu fan-outu pozwala wysłać kopię z **innego konta** i jest
dostępne w oknie (zakładka Konfiguracja). Przy jednym koncie z listą stacji nie
jest potrzebne — przydaje się, gdy kopia ma iść z konta innej osoby.

## Sprawdzanie konfiguracji wobec konta (od 0.1.9)

Serwis rozszerzył `PING`/`STATUS` (**2026-09-04**, na naszą prośbę) i podaje teraz,
czym konto dysponuje:

```json
{
  "operator": "SQ8BWM",
  "stations": ["SN0LPU", "SN8N", "SQ8BWA", "SQ8BWM"],
  "activeActions": [
    { "id": 295, "name": "15 lat Muzeum…", "from": "2026-08-29 00:00:00", "to": "2026-09-06 23:59:00" }
  ],
  "pinExpires": null,
  "apiEnabled": true
}
```

Mostek używa tego do sprawdzenia **pary** (PIN celu → znak stacji tego celu).
Sprawdza się wobec konta, którego kluczem kopia poleci — nie wobec konta
głównego, bo listy stacji są per konto.

| Stan reguły | Znaczy | Ostrzega przy zapisie |
|---|---|---|
| `ok` | stacja jest na liście konta | nie |
| `missing-station` | konta tej stacji nie mają | **tak** |
| `bad-pin` | serwis odrzucił PIN celu | **tak** |
| `api-disabled` | konto ma wyłączone API | **tak** |
| `no-pin` | brak PIN-u celu i głównego | **tak** |
| `no-active-action` | uprawnienia są, ale teraz nie ma akcji | nie — zależy od kalendarza |
| `unknown` | brak łączności albo starszy serwis | nie |

Zasady, na których to stoi:

- **Bez blokady zapisu.** Dane bywają nieaktualne o minutę (dokładnie tak było
  przy dopisywaniu `SQ8BWA`), serwis może nie odpowiedzieć, a „wpiszę regułę
  teraz, stację dopiszę wieczorem" to normalna kolejność pracy. Okno pyta,
  decyduje użytkownik.
- **`stations: null` ≠ `stations: []`.** Brak pola znaczy „serwis nie podał"
  (starsza wersja API) i daje `unknown`; pusta lista znaczy „konto nie ma ani
  jednej stacji" i ostrzega. Zlanie tych przypadków kazałoby ostrzegać przed
  poprawną konfiguracją na każdym starszym serwerze.
- **Cudze konta odpytywane tylko na starcie i po zapisie**, nie w pętli co
  minutę — nie wiadomo, czy `PING` wchodzi w limit 10/min razem z zapisami.
  Konto główne odświeża się przy cyklicznym PING-u za darmo, tym samym
  żądaniem.
- **Danych o cudzych kontach nie zapisujemy na dysk** ani nie pokazujemy dalej
  niż to potrzebne do komunikatu (sam znak operatora, nigdy listy stacji).
- **Brak odpowiedzi nigdy nie wstrzymuje wysyłki QSO.** Sprawdzanie jest
  wygodą, nie warunkiem pracy mostka.

### `action=VALIDATE` — jest, jeszcze nieużywane

Serwis przyjmuje `action=VALIDATE` (POST, `action` w query albo w ciele) i wtedy
niczego nie zapisuje:

```json
{ "success": true, "is_validation_only": true, "foundActions": 1,
  "wouldSaveTo": [295],
  "message": "Walidacja przebiegła pomyślnie. Żądanie jest poprawne i zostałoby zapisane." }
```

Sprawdzone 2026-09-04: to samo QSO wysłane dwa razy nie zgłosiło duplikatu,
a w dzienniku nie pojawiło się nic — czyli nie zapisuje i nie zajmuje numeru
deduplikacji.

Mostek tego jeszcze nie używa, bo znacznik `is_validation_only` pojawia się
**tylko przy sukcesie**. Gdy walidacja stwierdzi, że QSO nigdzie nie wejdzie,
odpowiedź jest nieodróżnialna od nieudanego prawdziwego zapisu — a to właśnie
ten przypadek jest wart sprawdzania. Zgłoszone autorowi serwisu.
