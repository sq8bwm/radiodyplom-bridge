# Loggery i dane

Które loggery są obsługiwane, jak je skonfigurować i co mostek robi z danymi, zanim wyśle je na radiodyplom.

[← powrót do README](../README.md)


## Obsługiwane loggery
Daemon rozpoznaje format **automatycznie po zawartości datagramu**, więc jeden port
obsługuje mieszane źródła jednocześnie.

| Dekoder | Format | Loggery |
|---|---|---|
| `QLog` | JSON `{appid:"QLog", data:{value:"<ADIF>"}}` | QLog |
| `N1MM` | XML `<contactinfo>` | N1MM+, DXLog, BBlogger, **RUMlogNG**, **Log4OM** |
| `WSJT-X` | binarny QDataStream, magic `0xADBCCBDA`, typ 5 | WSJT-X, JTDX ≥ 2.2.158, MSHV |
| `Logger32` | goły rekord ADIF, **po TCP** | Logger32 ≥ 4.0.344 |

Rozpoznanie jest jednoznaczne, bo rodziny różnią się początkiem: `{` → JSON,
`<nazwa:długość>` → ADIF, `<` bez długości → XML, `AD BC CB DA` → binarny.
Kolejność sprawdzania ma znaczenie: ADIF i XML zaczynają się tym samym znakiem,
więc ADIF (węższy wzorzec, z deklarowaną długością) jest sprawdzany pierwszy.

**Nieobsługiwane** (własne, odrębne protokoły): QARTest (9458), Swisslog (2333),
Win-Test (9871), Ham Radio Deluxe, WriteLog, LogHX. Każdy wymaga własnego dekodera —
dodanie polega na dopisaniu jednego pliku w `src/decoders/` i wpisaniu go do rejestru.

### Chcesz, żeby Twój logger był obsługiwany

Dekodera **nie da się napisać z opisu formatu** — sprawdziliśmy to dwa razy
i dwa razy się nie udało. Potrzebny jest prawdziwy datagram z Twojego programu.
Mostek zbiera je sam:

1. ustaw w loggerze wysyłkę UDP na `127.0.0.1` i port `12060` (albo ten, który
   masz w Konfiguracji),
2. zaloguj **jedno** QSO,
3. w mostku: zakładka *O programie* → **Zapisz zgłoszenie do wysłania**,
4. przyślij powstały plik.

Nieznany datagram jest w nim zapisany w całości. Nie trzeba niczego
przechwytywać ani instalować. W logu zobaczysz wtedy wpis `Nieznany datagram
z … zapisany do analizy`.

Zapisujemy **tylko to, czego nie umiemy odczytać**, i tylko **pierwszy datagram
każdego rodzaju** — najwyżej pięć rodzajów po 8 kB. Rozpoznane QSO nie są
odkładane nigdzie poza kolejką.


## Konfiguracja loggera
Ustaw wysyłkę UDP na `127.0.0.1:12060` (albo inny port, byle zgodny z `config.json`):

- **QLog** — `Settings → Network → Notifications → QSO Changes`
- **RUMlogNG (macOS)** — `Preferences → UDP → RUMlog, N1MM & TR4W compatible` (szczegóły niżej)
- **N1MM+ / DXLog** — broadcast na porcie 12060 (domyślny dla tej rodziny)
- **Log4OM** — `Settings → Program Configuration → Software integration → Connections`, zakładka UDP, sekcja **UDP OUTBOUND**, typ usługi **N1MM_CONTACT** (szczegóły niżej)
- **WSJT-X / JTDX / MSHV** — `Settings → Reporting → UDP Server` + port
- **Logger32** — patrz niżej, bo jako jedyny nie używa UDP

WSJT-X wysyła „QSO Logged” dopiero po zatwierdzeniu okna **Log QSO** — to celowe
zachowanie samego WSJT-X, nie ograniczenie daemona.


## Log4OM 2 — przez protokół N1MM

**Potwierdzone na żywym programie** (2026-10-05, Log4OM 2 v.2.41.0.0 na Windowsie 11):
QSO zalogowane w Log4OM dochodzi do mostka i przechodzi całą drogę aż do wysyłki.

Log4OM nie ma osobnego trybu „radiodyplom" — używamy jego **wyjścia N1MM**, bo wysyła
dokładnie ten sam datagram XML `<contactinfo>`, który mostek już rozumie.

Konfiguracja krok po kroku:

1. **Settings ➪ Program Configuration** (menu górne).
2. W drzewie po lewej: **Software integration ➪ Connections**, zakładka **UDP**.
3. W prawej kolumnie **UDP OUTBOUND** wypełnij:
   - **Port** — `12060` (ten sam, co `udp.port` w `config.json`),
   - **Connection name** — dowolna nazwa, np. `RADIODYPLOM-BRIDGE`,
   - **Service type** — **`N1MM_CONTACT`**,
   - **Destination IP Address** — `127.0.0.1` (mostek na tym samym komputerze),
   - **Broadcast** — niezaznaczone.
4. Dodaj wpis zielonym **+** i upewnij się, że na liście *UDP Outbound connections*
   ma **zaznaczony haczyk** — bez niego połączenie jest wyłączone.
5. **Save and apply**.

Gotowy wpis wygląda na liście tak:

```
[UDP_OUTBOUND] [N1MM_CONTACT] [12060] RADIODYPLOM-BRIDGE
```

Od tego momentu każde QSO dodane w Log4OM leci do mostka od razu po zapisaniu.
Sprawdzone pola: znak, data, czas, pasmo, emisja, raporty, częstotliwość, operator
i znak stacji — czyli komplet potrzebny do wysyłki.

**Uwaga na częstotliwość.** Pole *Freq* w Log4OM jest w kHz (`7100` to 7,1 MHz)
i steruje pasmem. Dopóki jest puste albo niepoprawne, Log4OM **nie zapisze QSO**
i nic nie wyśle — a komunikat o tym jest dyskretny (żółty trójkąt przy polu *Band*).


## RUMlogNG (macOS) — przez protokół N1MM

**Potwierdzone na żywym programie** (2026-10-02, RUMlogNG na macOS, zgłoszone
przez SO8KP): QSO dochodzi do mostka i przechodzi całą drogę. Przechwycony
datagram jest w testach (`test/decoders.test.js`), więc zmiana w dekoderze,
która by go zepsuła, zatrzyma się na testach.

RUMlogNG (popularny logger na system macOS autorstwa DL2RUM) **posiada wbudowane
wsparcie dla protokołu N1MM/TR4W przez UDP**. Wysyła standardowy datagram
XML `<contactinfo>`, który w moście jest automatycznie rozpoznawany i obsługiwany
przez dekoder N1MM.

Konfiguracja krok po kroku w **RUMlogNG**:

1. W menu górnym wybierz: **RUMlogNG ➪ Preferences** (lub skrót **`Cmd + ,`**).
2. Przejdź do zakładki **UDP**.
3. W sekcji **RUMlog, N1MM & TR4W compatible**:
   - zaznacz **App info** i podaj adres oraz port: `127.0.0.1` / `12060`,
   - zmień jedną z pozycji **Contact info Off** na **Contact info N1MM**,
   - wpisz ten sam adres i port: `127.0.0.1` / `12060`.
4. Zamknij okno preferencji (zmiany sieciowe w RUMlogNG zatwierdzają się po
   zamknięciu okna).

Od tego momentu każde dodane i zapisane QSO w RUMlogNG zostanie natychmiast
rozgłoszone przez UDP i odebrane przez mostek.


## Logger32 — jedyny po TCP

Logger32 **nie rozgłasza QSO po UDP**. Od wersji **4.0.344** ma funkcję
„enable QSO export by TCP": jako klient TCP łączy się pod wskazany adres i port
(domyślnie **52005**) i wysyła każde zalogowane QSO w ADIF-ie, po czym zamyka
połączenie. Dlatego mostek ma dla niego **osobny nasłuch**, domyślnie wyłączony.

Co ustawić — **po stronie mostka**:

1. zakładka *Konfiguracja* → **Logger32 (nasłuch TCP)** → zaznacz „Odbieraj QSO
   z Logger32 po TCP" i **uruchom program ponownie** (gniazdo powstaje przy starcie).

Po stronie **Logger32** (kolejność z instrukcji programu, §32.3, plus krok,
o którym instrukcja nie mówi wprost):

1. prawy klik w dowolne pole wpisu QSO → **Setup ➪ QSLing & QSO Export** →
   zaznacz **„Enable export of QSO logging by TCP"**,
2. prawy klik panel **TCP** na pasku stanu → **„Show TCP client event viewer"**,
3. w tym oknie menu **Config** → adres IP i port maszyny z mostkiem (domyślnie
   `52005`),
4. **prawy klik panel TCP na dole → „Click to Open socket"** — dopóki tego nie
   zrobisz, wszystko wygląda na ustawione, a **nic nie leci**. Po otwarciu
   gniazda napis **TCP robi się zielony** i to jest jedyny widoczny znak, że
   połączenie jest czynne.

Sprawdzenie: przycisk **„Test the connection"** w event viewerze wysyła tekst
**„Hello World!"**, a nie ADIF — mostek zapisze wtedy w logu ostrzeżenie
„nie rozpoznaję jako ADIF". Wbrew pozorom to **dobra wiadomość**: znaczy, że
dane docierają. Prawdziwe QSO daje wpis „Nowe QSO [ADIF]" — źródło nazywa się
formatem, bo ten sam ADIF przysyła nam też BBLogger.

**Dwie instancje mostka a port 52005.** Bind TCP jest wyłączny, więc druga
instancja z włączonym Logger32 na tym samym porcie nie wstanie — i to nie
„częściowo": błąd nasłuchu przerywa start całego rdzenia, razem z UDP, a okno
pokazuje baner „Mostek nie wystartował". Dlatego katalog zakładany dla instancji
portable dostaje od razu własny port TCP (52015, 52025…). Przy ręcznym ustawianiu
drugiej instancji zmień `tcp.port` sam i wpisz ten sam numer w Logger32.

> **Nie pomyl z „parallel logging"** (§32.4 instrukcji Logger32). To osobna
> funkcja, do spinania dwóch Logger32 między sobą; ma własny *TCP server event
> viewer* i własny port. Jeśli Logger32 i mostek stoją na tej samej maszynie,
> serwer Logger32 nasłuchujący na 52005 **zajmie port** mostkowi.

Sprawdzone przez sieć 2026-10-01: Logger32 na Windowsie, mostek na Linuksie
w tej samej sieci, `tcp.host: 0.0.0.0` — QSO przeszło i zostało zapisane
w akcji. To ten sam układ, co [mostek na Raspberry Pi](malinka.md).

Komu QSO podaje **wyłącznie Logger32**, ten może wyłączyć nasłuch UDP
(`udp.enabled: false`, przełącznik w zakładce Konfiguracja) — wtedy port UDP
w ogóle się nie otworzy.

Logger32 na **innym komputerze**: ustaw w mostku adres `0.0.0.0` i wpisz
w Logger32 adres maszyny z mostkiem. Uwaga — wtedy port jest otwarty na całą
sieć lokalną, więc dopisać QSO do Twojej akcji może każdy, kto się do niego
dobierze.

### Co Logger32 naprawdę wysyła

Przechwycone z żywego programu (2026-09-30, wersja 4.0.344):

```
<BAND:3>80m <CALL:6>SQ8BWA <CONT:2>EU <CQZ:2>15 <DXCC:3>269 <FREQ:8>3.700000
<ITUZ:2>28 <MODE:3>SSB <OPERATOR:6>SQ8BWM <PFX:3>SQ8 <QSLMSG:0>
<QSO_DATE:8>20260930 <TIME_ON:6>155158 <RST_RCVD:2>59 <RST_SENT:2>59
<TIME_OFF:6>155232 <APP_LOGGER32_QSO_NUMBER:1>1 <EOR>
```

Dwie rzeczy z tego wynikają i obie są obsłużone:

- **Nie ma pola `STATION_CALLSIGN`**, a radiodyplom sprawdza właśnie znak
  stacji. Znak, pod którym pracujesz, siedzi w Logger32 w polu **`OPERATOR`** —
  stamtąd go bierzemy, gdy `STATION_CALLSIGN` nie przyszło, i mówimy o tym raz
  w logu. Jeśli pracujesz pod **innym** znakiem niż operator (np. pod znakiem
  klubowym), dopisz go w *Rozmnażanie QSO na wiele stacji* — reguła nadpisuje
  znak z loggera.
- **Jest własny numer QSO** (`APP_LOGGER32_QSO_NUMBER`), więc klucz
  deduplikacji opiera się o niego razem z odciskiem treści — tak samo jak przy
  QLogu, a nie tylko o treść jak przy WSJT-X.

Zwróć też uwagę, że tagi są WIELKIMI literami, pola rozdzielone spacjami,
a `<QSLMSG:0>` ma zerową długość — wszystko to parser obsługuje, a test
z tym rekordem (wklejonym bajt w bajt) tego pilnuje.

Ograniczenia, których nie da się obejść po naszej stronie:

- eksport po TCP obejmuje **tylko dodania**; edycje i skasowania w Logger32 nie
  są wysyłane (tak samo jak przy pozostałych loggerach mostek i tak przekazuje
  wyłącznie nowe QSO),
- Logger32 nie podaje żadnego numeru rekordu, więc klucz deduplikacji powstaje
  **wyłącznie z treści QSO** — dokładnie jak przy WSJT-X.

**Sprawdzenie bez Logger32** (działa tylko na Windowsie):

```bash
npm run logger32-test -- --ile 2 --stacja SN8N --pasmo 20m --emisja FT8
```

Narzędzie udaje Logger32: łączy się, wysyła rekord ADIF i rozłącza. Przydaje się
też przy zgłoszeniu błędu — łatwiej poprosić o jedno polecenie niż o opis.


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
