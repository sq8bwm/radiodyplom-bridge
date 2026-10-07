# Loggery i dane

Które loggery są obsługiwane, jak je skonfigurować i co mostek robi z danymi, zanim wyśle je na radiodyplom.

[← powrót do README](../README.md)


## Obsługiwane loggery
Daemon rozpoznaje format **automatycznie po zawartości datagramu**, więc jeden port
obsługuje mieszane źródła jednocześnie.

| Dekoder | Format | Loggery |
|---|---|---|
| `QLog` | JSON `{appid:"QLog", data:{value:"<ADIF>"}}` | QLog |
| `N1MM` | XML `<contactinfo>` | N1MM+, DXLog, **RUMlogNG**, **Log4OM**, **BBLogger** (tryb XML), **QARTest** |
| `WSJT-X` | binarny QDataStream, magic `0xADBCCBDA`, typ 5 i 12 | WSJT-X, JTDX ≥ 2.2.158, **MSHV** |
| `Logger32` | goły rekord ADIF | Logger32 ≥ 4.0.344 (**po TCP**), **BBLogger** (tryb ADIF, po UDP) |

Rozpoznanie jest jednoznaczne, bo rodziny różnią się początkiem: `{` → JSON,
`<nazwa:długość>` → ADIF, `<` bez długości → XML, `AD BC CB DA` → binarny.
Kolejność sprawdzania ma znaczenie: ADIF i XML zaczynają się tym samym znakiem,
więc ADIF (węższy wzorzec, z deklarowaną długością) jest sprawdzany pierwszy.

**Nieobsługiwane** (własne, odrębne protokoły): Swisslog (2333),
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
- **N1MM+ / DXLog** — `Config → Configure Ports…`, zakładka **Broadcast Data**, zaznaczone **Contacts** (szczegóły niżej)
- **Log4OM** — `Settings → Program Configuration → Software integration → Connections`, zakładka UDP, sekcja **UDP OUTBOUND**, typ usługi **N1MM_CONTACT** (szczegóły niżej)
- **BBLogger** — `Tools → Configuration/Maintenance → QSO UDP Broadcast`, format **ADIF** albo **XML (N1MM)** (szczegóły niżej)
- **QARTest** — `Options → External data broadcast`, zaznaczone **QSO** (szczegóły niżej)
- **WSJT-X / JTDX / MSHV** — `Settings → Reporting → UDP Server` + port
- **Logger32** — patrz niżej, bo jako jedyny nie używa UDP

WSJT-X wysyła „QSO Logged” dopiero po zatwierdzeniu okna **Log QSO** — to celowe
zachowanie samego WSJT-X, nie ograniczenie daemona.

**Dwa komunikaty o jednej łączności.** Ta rodzina zna dwa sposoby zgłoszenia QSO:
typ 5 („QSO Logged", pola binarne) i typ 12 („Logged ADIF", pełny rekord ADIF).
Mostek rozumie **oba** i nie policzy łączności dwa razy, bo oba dają ten sam odcisk
treści. Ma to znaczenie praktyczne:

- **WSJT-X** wysyła oba naraz — nic nie trzeba ustawiać,
- **MSHV** w oknie *Network Configuration* ma dwa osobne przełączniki wysyłki QSO.
  Zmierzone na żywych łącznościach FT4 (MSHV 2.76.3, 2026-10-06):

  | zaznaczone | co wysyła |
  |---|---|
  | tylko **Enable Logged QSO ADIF** | wyłącznie **typ 12** |
  | tylko **Enable Logged QSO** (podpowiedź: „Logger32, etc.") | wyłącznie **typ 5** |
  | oba | **oba naraz**, tę samą łączność |

  Do **0.1.38** mostek czytał tylko typ 5 — przy pierwszym ustawieniu QSO z MSHV
  nie dochodziły wcale, a jedynym śladem był wpis w logu na poziomie debug.

**FT4 przychodzi jako MFSK.** ADIF trzyma FT4 jako `MODE=MFSK` + `SUBMODE=FT4`,
bo formalnie jest podtypem MFSK. Tak wysyła MSHV (w komunikacie ADIF) **i QLog**;
WSJT-X idzie na skróty i wpisuje wprost `MODE=FT8`. Do **0.1.38** czytaliśmy samo
`MODE`, więc **każda łączność FT4 szła na radiodyplom.pl jako „MFSK"** — przechodziła,
ale z emisją, która nic nie znaczy. Od **0.1.39** `SUBMODE` ma pierwszeństwo.

**Emisja decyduje o punktacji.** W konfiguracji akcji organizator zaznacza
*dozwolone emisje*, a lista ma `FT8`, `FT4`, `MFSK`, `FT2`, `PSK31`, `C4FM` i inne
jako **osobne pozycje**. Jeśli organizator zaznaczy `FT4`, a mostek wyśle `MFSK`,
łączność **nie zostanie punktowana** — będzie widoczna w logu, ale nie policzy się
do dyplomu. Zgłoszenia takiego nikt by z mostkiem nie powiązał.

**Serwer SPRAWDZA emisję i odrzuca nieznane — trwale.** Zmierzone 2026-10-06
uploadami na akcję testową:

| wysłane | wynik |
|---|---|
| `FT4`, `MFSK`, `C4FM`, `PSK31`, `DIGI`, `NXDN`, `FT2` | przyjęte, zapisane dosłownie |
| `JS8`, `Q65`, wymyślone `ZZTEST` | **odrzucone**: `INVALID_MODE — Nieprawidłowa lub nieobsługiwana emisja (mode/submode)` |

Odrzucenie jest **trwałe**: QSO ląduje w `failed/` i do dyplomu nie trafia wcale.
Lista przyjmowanych pokrywa się z tą z panelu organizatora.

Ma to bezpośredni skutek dla podtypów: łączność **JS8** przychodzi jako
`MODE=MFSK` + `SUBMODE=JS8`, a serwer `JS8` odrzuca.

**Mostek nie decyduje, co serwis obsługuje.** Wysyłamy wiernie to, co podał
logger — podtyp jest dokładniejszy, więc idzie pierwszy. Gdy serwer odpowie
`INVALID_MODE`, mostek **ponawia to samo QSO z rodziną** (`JS8` → `MFSK`)
i odnotowuje to w logu:

```
QSO SP9ABC: serwer nie zna emisji JS8, ponawiam jako MFSK (rodzina z rekordu loggera)
```

Dzięki temu nie ma w kodzie listy obsługiwanych emisji, która i tak zestarzałaby
się przy pierwszej zmianie po stronie serwisu — a nowe emisje zaczną działać bez
aktualizacji mostka.

**Czego ponowienie nie uratuje.** Gdy logger poda emisję bez podtypu, a serwer
jej nie zna, nie mamy czym jej zastąpić — i nie wymyślamy zamiennika. Tak jest
z **Q65**: WSJT-X wysyła go jako `MODE=Q65`, bez `SUBMODE`, więc po odmowie
serwera QSO trafia do `failed/`. Trzeba je wtedy dodać ręcznie albo poprosić
organizatora o dopisanie tej emisji do akcji. Przy JS8 jest czym ratować, bo
przychodzi jako `MODE=MFSK` + `SUBMODE=JS8`.

To samo dotyczy zapisu pasma: MSHV w rekordzie ADIF podaje `20M`, a wyliczenie
z częstotliwości daje `20m`. Ujednolicamy do małych liter — inaczej ta sama łączność
z dwóch komunikatów tego samego programu miała różny odcisk treści i szła **dwa razy**.

**Multicast to nie kolizja.** WSJT-X i MSHV nadają domyślnie na grupę
`224.0.0.222:2239`, a multicast daje **każdemu słuchaczowi własną kopię** — mostek
może więc odbierać równolegle z QLogiem czy innym programem i nikt nikomu nic nie
zabiera (inaczej niż przy unicaście na 12060, patrz wyżej). Żeby odbierać
bezpośrednio z grupy, ustaw `udp.host: "0.0.0.0"`, `udp.port: 2239` i
`udp.multicastGroups: ["224.0.0.222"]`.


## Dwa programy odbierające QSO na jednym porcie

Port **12060** nie jest „nasz" — to domyślny port **rodziny N1MM** i słucha na nim
każdy program odbierający QSO z loggerów, nie tylko mostek. Jeśli obok działa drugi
taki program (np. HamConnect, którego instrukcja też każe ustawić 12060), oba
zbindują port bez błędu, ale **datagram dostanie tylko jeden z nich**.

Zmierzone 2026-10-05, tym samym kodem na obu systemach:

| system | kto odbiera |
|---|---|
| Windows 11 | ten, który zbindował się **pierwszy** |
| Linux | ten, który zbindował się **później** |

Nie da się więc nawet powiedzieć „wygrywa uruchomiony później". Od **0.1.38** mostek
sprawdza to przy starcie i wypisuje ostrzeżenie — wcześniej część QSO przepadała bez
jednego słowa w logu i wyglądało to na usterkę loggera.

**Rozwiązanie: każdemu odbiorcy własny port.** Loggery wysyłają do kilku celów naraz,
więc nie trzeba niczego dzielić:

- **BBLogger** — trzy niezależne gniazda (`UDP 1`, `UDP 2`, `UDP 3`), każde z własnym
  adresem, portem i formatem,
- **Log4OM** — dowolna liczba połączeń w sekcji *UDP OUTBOUND*,
- **N1MM+ / DXLog** — kilka adresów w *Broadcast Data*.

Port odbioru w drugim programie zwykle też da się zmienić — HamConnect ma go
w ustawieniach obok dwóch innych. Zmieniaj ten, który łatwiej zmienić; ważne, żeby
numery były różne i żeby logger wysyłał do obu.

## N1MM Logger+ — macierzysty protokół

**Potwierdzone na żywym programie** (2026-10-07, N1MM Logger+ 1.0.11462 na Windowsie 11):
QSO zalogowane w N1MM+ dochodzi do mostka i przechodzi całą drogę. Przechwycony
datagram jest w testach (`test/n1mm-plus.test.js`).

To od tego programu wziął nazwę nasz dekoder `n1mm` — ale jego własnych bajtów
zobaczyliśmy dopiero tego dnia. Wszystko, co wcześniej mieliśmy przechwycone w tej
rodzinie, pochodziło od **innych** programów mówiących tym protokołem: RUMlogNG,
QARTest, Log4OM.

Konfiguracja krok po kroku:

1. **Config ➪ Configure Ports, Mode Control, Winkey, etc…** (menu okna wprowadzania).
2. Zakładka **Broadcast Data**.
3. Zaznacz **Contacts**. Pole adresu obok ma już wpisane `127.0.0.1:12060` —
   **to jest nasz domyślny port**, więc przy domyślnej konfiguracji mostka nie
   trzeba tam niczego zmieniać. Wystarczy sam haczyk.
4. **OK**.

Pozostałe pozycje (*Application Info*, *Radio*, *Spots*, *Score*) są dla mostka
nieistotne — zaznaczenie samych *Contacts* wystarcza i nie zasypuje portu resztą ruchu.

**Zanim zalogujesz pierwsze QSO**, wypełnij **Config ➪ Change Your Station Data**.
Bez tego N1MM+ wita się okienkiem *Missing Station Info* i nie pracuje poprawnie.
Pole **ARRL Section** jest wymagane także poza USA — wpisuje się tam `DX`, inaczej
okno danych stacji nie da się zamknąć.

Co N1MM+ wysyła, a czego nie widać u innych programów tej rodziny:

| pole | jak jest | co z tego mamy |
|---|---|---|
| `<ID>` | GUID bez myślników | klucz deduplikacji nie musi liczyć odcisku treści |
| `<operator>` | wypełnione | nie trzeba zapasu z `<mycall>` |
| `<mode>` | wstęga (`USB`/`LSB`), nie `SSB` | sprowadzamy do `SSB`, bo serwer zna emisję, nie wstęgę |
| `<txfreq>` | dziesiątki herca (`1420000` to 14,2 MHz) | zmierzone na jego własnych bajtach, nie przyjęte z dokumentacji |
| `<SentExchange />` | tag zamknięty sam w sobie | jedyny taki w naszych zbiorach — parser musi go przejść |

**Ustawienia zapisują się przy wyjściu**, podobnie jak w Log4OM: plik
`Documents\N1MM Logger+\N1MM Logger.ini` rośnie dopiero po zamknięciu programu.
Podmiana ustawień „na żywo" zostanie więc cofnięta.

## Log4OM 2 — przez protokół N1MM

**Potwierdzone na żywym programie** (2026-10-05, Log4OM 2 v.2.41.0.0 na Windowsie 11):
QSO zalogowane w Log4OM dochodzi do mostka i przechodzi całą drogę aż do wysyłki.
Datagram przechwycony 2026-10-07 leży w testach (`test/log4om.test.js`).

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

Czego Log4OM **nie** podaje, a my sobie z tym radzimy (z przechwyconego datagramu,
2026-10-07):

| pole | jak jest | co robimy |
|---|---|---|
| `<operator>` | taga nie ma wcale | bierzemy znak z `<mycall>` |
| `<id>` | brak | klucz deduplikacji liczymy z treści QSO |
| `<band>` | `14` — MHz-y jako goła liczba, nie nazwa ADIF | pasmo liczymy z częstotliwości |
| `<app>` | `LOG4OM2` | tego akurat nie brakuje — stąd nazwa programu w logu |

Jednostka `<txfreq>` jest tu taka jak w N1MM+ (setne części kHz: `1407400` to
14,074 MHz), więc pułapka znana z BBLoggera tu nie występuje. Uwaga: **nie rozstrzyga
tego sąsiednie `<band>`** — „14" nie jest nazwą pasma ADIF, więc działa przelicznik
domyślny. Gdyby Log4OM kiedyś przeszedł na jednostki BBLoggera, ta sama liczba
dałaby 140,74 MHz; pilnuje tego test.

Log4OM wysyła XML **sformatowany** — z deklaracją `<?xml?>`, wcięciami po dwie spacje
i złamaniami linii CRLF między tagami. Tak samo robi N1MM+ (tylko tabulatorami);
QARTest i BBLogger wysyłają wszystko w jednej linii. Dla dekodera bez znaczenia, ale
przy podglądaniu ruchu widać to od razu.

**Dwie rzeczy, które zaskakują przy zmianie portu** (obie kosztowały nas czas 07.10):

- Log4OM **przepisuje `config.json` przy wyjściu**, z ustawień trzymanych w pamięci.
  Podmiana pliku przy działającym programie nie da więc nic — trzeba najpierw zamknąć
  Log4OM, a dopiero potem przywracać plik. Odwrotna kolejność wygląda na skuteczną,
  bo plik faktycznie się zmienia; program po prostu cofa to kilka minut później.
- Proces **nie nazywa się „Log4OM" tylko `L4ONG`**. `Get-Process Log4OM*` nie znajduje
  nic i wygląda to jak potwierdzenie, że program jest zamknięty. Sprawdzać po oknie
  albo po `L4ONG`.


## QARTest — przez protokół N1MM

**Potwierdzone na żywym programie** (2026-10-05, QARTest 16.9.1 na Windowsie 11):
QSO dochodzi do mostka i przechodzi całą drogę, **bez żadnej zmiany po naszej
stronie**. Przechwycony datagram jest w testach (`test/qartest.test.js`).

Do tego dnia ten dokument wymieniał QARTest wśród **nieobsługiwanych**, z adnotacją
„własny, odrębny protokół (9458)". To nieprawda — twierdzenie pochodziło
z pierwszego commitu (31 sierpnia) i nigdy nie zostało sprawdzone. QARTest wysyła
zwykły XML `<contactinfo>`, czyli dokładnie to, co rozumiemy od początku.

Konfiguracja:

1. **Options ➪ External data broadcast** (w wersji włoskiej: *Opzioni ➪ Broadcast
   esterno dati*).
2. Zaznacz **QSO**, wpisz adres `127.0.0.1` i port `12060`.
3. Opcja **also send QSO's received from the network** dotyczy pracy
   wielostanowiskowej — decyduje, czy wysyłać dalej także QSO zalogowane na innych
   stanowiskach połączonych w sieć QARTesta. Przy jednym komputerze nie zmienia nic.

Czego QARTest **nie** podaje, a my sobie z tym radzimy:

| pole | jak jest | co robimy |
|---|---|---|
| `<operator>` | puste | bierzemy znak z `<mycall>` |
| `<app>` | puste | nazwę programu czytamy z `<logger>` („QARTest 16.9.1") |
| `<band>` | `160` — metry jako goła liczba, nie MHz-y ani nazwa ADIF | pasmo liczymy z częstotliwości |
| grid | brak | pole zostaje puste |

Jednostka `<txfreq>` jest tu taka jak w N1MM+ (setne części kHz: `180000` to
1,8 MHz), więc pułapka znana z BBLoggera tu nie występuje.

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


## BBLogger — ADIF datagramem UDP

**Potwierdzone na żywym programie** (2026-10-05, BBLogger 14.7 na Windowsie 11):
QSO dochodzi do mostka i przechodzi całą drogę — w **obu** trybach. Datagramy
z tej próby są wklejone do testów, więc zmiana, która by je zepsuła, zatrzyma się
na testach.

BBLogger daje **oba formaty do wyboru** — lista *Format* ma pozycje `ADIF`
i `XML (N1MM)`. Sprawdzone w programie 2026-10-05.

Nasz dawny wpis „BBlogger → N1MM" nie był więc fałszywy, ale był **niesprawdzony**
i mylący: w żadnym materiale autorów słowo „N1MM" nie pada ani razu, a instrukcja
podłączenia do HamAward każe wybrać ADIF. Kto szedł za ich instrukcją, dostawał
od nas format, którego u siebie nie wybrał.

Mostek rozumie **oba** — ADIF i XML N1MM mają u nas osobne dekodery i wspólną
drogę dalej. Nie trzeba niczego dobierać; wystarczy, że wybór w BBLoggerze zgadza
się z tym, co w kolumnie Źródła zobaczysz jako nazwę formatu.

Konfiguracja według instrukcji autorów:

1. **Tools ➪ Configuration/Maintenance ➪ QSO UDP Broadcast**
   (w wersji włoskiej: *Strumenti ➪ Configurazione/Manutenzione*).
2. W sekcji **UDP 1** wpisz: **IP/Host** `127.0.0.1`, **Port** `12060`,
   **Format** `ADIF` (albo `XML (N1MM)` — mostek przyjmie oba).
3. W oknie wprowadzania QSO (**F2**) kliknij przycisk **UDP1** — z szarego robi się
   **czerwony**. Dopiero wtedy dane wychodzą; sam wpis w konfiguracji nie wystarcza.

**Sekcje są trzy: UDP 1, UDP 2 i UDP 3.** To ważne, gdy ktoś wysyła QSO do dwóch
platform naraz: zamiast dzielić z kimś jeden port (co kończy się cichą utratą
części QSO), daje się każdemu odbiorcy własny numer.

Cytat z instrukcji (BBLogger 1.1.7.2, podłączenie do HamAward):

> Nel campo UDP 1 dovrebbero essere già inseriti i parametri di IP/Host, Porta e
> Formato […] **IP/Host 127.0.0.1 e Porta 12060. Il formato ADIF va benissimo.**

Port 12060 to ten sam, który mamy domyślnie, więc po stronie mostka nie trzeba
zmieniać niczego.

**Zielone okienko w tym samym oknie to co innego** — obsługuje dane wchodzące DO
BBLoggera z programów FT8/FT4 i JT Alert (port 2334 i podobne). Z wysyłką do nas
nie ma nic wspólnego.

Po naszej stronie ADIF przysłany datagramem UDP przechodzi tą samą drogą co rekord
z Logger32 — pilnują tego testy w `test/bblogger.test.js`. W kolumnie **Źródła** QSO
z BBLoggera pokaże się pod nazwą dekodera ADIF-a.

### Tryb XML wymagał poprawki po naszej stronie

Do wersji 0.1.37 QSO z BBLoggera w trybie **XML (N1MM)** przechodziło z **dziesięć
razy za małą częstotliwością i bez pasma** — zmierzone: `14.2500` w trybie ADIF, a
`1.425` w trybie XML, z pustym pasmem. Przyczyny były dwie:

| pole | N1MM+ | BBLogger |
|---|---|---|
| `<txfreq>` | setne części kHz (`1425000`) | **dziesiąte** części kHz (`142500`) |
| `<band>` | MHz-y (`14`) | **nazwa pasma ADIF** (`20m`) |

Mostek dzielił zawsze jak dla N1MM+, a zapasowe `<band>` próbował czytać jako
liczbę. Od **0.1.38** jednostkę rozstrzyga pasmo: brany jest ten przelicznik, który
trafia w pasmo podane przez logger. Samo zgadywanie „ta wartość, która wpada
w jakiekolwiek pasmo" byłoby cichym błędem — `181000` to po N1MM-owemu 1,81 MHz,
czyli istniejące pasmo 160 m, a naprawdę jest to 18,1 MHz (17 m).

Kto loguje przez BBLoggera w trybie XML na wersji starszej niż 0.1.38, ma w logu
na radiodyplom.pl złe częstotliwości.

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
