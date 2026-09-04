# Loggery i dane

Które loggery są obsługiwane, jak je skonfigurować i co mostek robi z danymi, zanim wyśle je na radiodyplom.

[← powrót do README](../README.md)


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


## Co QLog wysyła poza nowym QSO

QLog nadaje datagram przy **każdej** operacji w dzienniku, nie tylko przy
dodaniu łączności. Mostek przekazuje wyłącznie `insert` (`forward.operations`),
bo poprawionego QSO nie ma po co wysyłać drugi raz — radiodyplom przyjął już
oryginał, a powtórka byłaby duplikatem.

**Jedna poprawka rekordu w QLogu = DWA datagramy** `operation: "update"`
(zmierzone 2026-09-04 na dwóch niezależnych obserwacjach: 1 edycja → 2
datagramy, 2 edycje → 4). To ważne przy czytaniu licznika „pominięte świadomie"
w panelu **Źródła**: liczy on **datagramy**, a nie Twoje czynności.

Niesprawdzone: czy `delete` też przychodzi podwójnie.

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
