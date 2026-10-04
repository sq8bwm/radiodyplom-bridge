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
- praca w tle po zamknięciu okna przez dłuższy czas.

**Potwierdzone 2026-09-08 na prawdziwym Windowsie:** program uruchamia się,
okno działa, PIN sprawdzony. Nasłuch w sieci był wtedy ODRZUCONY, bo Windows nie
ma `openssl` — czyli fail-closed zadziałał zgodnie z projektem. Powód nie
docierał jednak do okna (znał go tylko log) i to zostało naprawione w 0.1.20.

**Potwierdzone 2026-09-08 na 0.1.21, ta sama maszyna (DESKTOP-P35FDV1):** nasłuch
w sieci DZIAŁA na Windowsie bez instalowania czegokolwiek. W logu certyfikat
wystawiony „bez openssl-a, wbudowanym koderem", z adresem maszyny w SAN;
`https://0.0.0.0:12061`, kłódka w oknie, logowanie z przeglądarki przez adres
w sieci lokalnej udane.

**Wejście z telefonu potwierdzone (Chrome/Android, ta sama sieć):** ostrzeżenie
`ERR_CERT_AUTHORITY_INVALID` — czyli „nikt zaufany tego nie podpisał", a NIE
niezgodność nazwy, więc adres IP w SAN działa. Po przejściu ostrzeżenia całe
okno działa poprawnie na ekranie telefonu. Ubocznie wyszło, że dokumentacja
obiecywała porównanie odcisku „przy pierwszym wejściu" — a strona ostrzeżenia
odcisku nie pokazuje; opis poprawiony na `openssl s_client`.

**Rozstrzygnięte w 0.1.21:** certyfikat wystawiamy BEZ `openssl` (`src/cert.js`,
własny koder DER). Obawa o „nie mamy czym tego sprawdzić" okazała się nietrafiona
— sprawdzamy trzema niezależnymi drogami (`test/certyfikat.test.js`): parserem
`crypto.X509Certificate`, PRAWDZIWYM uściskiem dłoni TLS (także po adresie IP)
i `openssl x509` jako trzecią opinią tam, gdzie narzędzie jest. Błąd w kodowaniu
`UTCTime` z pierwszej wersji wyłapał parser natychmiast („Bad time value").
`openssl` nadal jest drogą pierwszą, gdy go widać w `PATH`.

**Przycisk „Zrestartuj teraz" — sprawdzony na wszystkich trzech drogach.**
Linux ze źródeł: klikaniem (nowy PID, zmiana wymagająca restartu zastosowana,
czyste zamknięcie). **Windows z instalatora, 2026-09-08: działa.**
**Windows portable, 2026-09-08: dwa restarty pod rząd, po każdym JEDNA ikona
w zasobniku** — czyli blokada jednej instancji jest oddawana poprawnie, a to
było większe z dwóch ryzyk utwardzanych w ciemno (nowy proces startuje, gdy
stary może jeszcze trzymać blokadę; zwalniamy ją jawnie przed wyjściem, ale
wyścig zależy od kolejności zamykania w systemie).

Przy okazji wyszło, czego nie dało się sprawdzić: **która wersja właściwie
wystartowała**. Instalator i portable dzielą na Windowsie ten sam
`%APPDATA%\radiodyplom-bridge` — tę samą konfigurację, ten sam PIN i tę samą
blokadę — a w logu piszą identyczne linie. Stąd wiersz **„Instalacja"**
w zakładce O programie (0.1.22), który mówi wprost *portable* wraz z nazwą
klikniętego pliku.

**Rozwiązane inaczej niż planowano (0.1.22):** portable i wersja instalowana
mogą teraz pracować OBOK SIEBIE — katalog `radiodyplom-dane` obok pliku
przenosi konfigurację i dane, a katalog `userData` (na którym wisi blokada
jednej instancji Electrona) przestawiamy przed jej pobraniem. Sprawdzone na
uruchomionym programie: instalowana na 12060/12061 i portable na 12070/12071
naraz, każda z własną kolejką. Opis: docs/konfiguracja.md.

Zostaje do sprawdzenia:

- **powtórzyć restart portable na 0.1.22** i potwierdzić, że wiersz nadal mówi
  „portable" — dopiero to zamyka pytanie, w którą stronę celuje
  `PORTABLE_EXECUTABLE_FILE` (zmienną ustawia instalator portable
  electron-buildera, sprawdzone w
  `app-builder-lib/templates/nsis/portable.nsi`);
- **czy stary katalog tymczasowy portable jest sprzątany** po restarcie —
  program go nie tworzy i nie usuwa, robi to launcher, więc może zostawać;
- **restart pod obciążeniem**, z loggerem nadającym QSO.


## Świadomie odłożone

### Przepisanie historii commitów — NIE robimy
**Decyzja (2026-09-03).** Historia zostaje jaka jest, z widocznym okresem ISC.
Nie dopisujemy też noty o zmianie licencji do README.

Powód, żeby nie wracać: przepisanie commitów **nie zmieniłoby licencji**, tylko
sprawiło, że historia twierdziłaby coś nieprawdziwego. Okres ISC był faktem —
wersje 0.1.0–0.1.5 zostały wydane na tej licencji i kto je pobrał, ma prawa
z ISC bezterminowo. O licencji decyduje **bieżące drzewo**: `LICENSE`, pole
w `package.json`, metadane paczek i zakładka „O programie" — wszystko mówi
GPL-3.0-or-later i to jest jednoznaczne.

Techniczna strona, gdyby kiedyś wróciło: `git filter-branch --tree-filter`
przeszedłby po 30 commitach, podmieniając pole `license` i dokładając `LICENSE`.
Wykonalne w minutę; problem nie jest techniczny.

### Stary PIN SQ8BWA w obiektach GitHuba — zamknięte, zostaje jak jest
**Rozstrzygnięte 2026-09-04.** Zgłoszenia do GitHub Support **nie wysyłamy** —
sprawdzone w dokumentacji (*Removing sensitive data from a repository*):

> GitHub Support won't remove non-sensitive data, and will only assist in the
> removal of sensitive data in cases where we determine that the risk can't be
> mitigated by rotating affected credentials.

PIN został wymieniony 2026-09-02, więc ryzyko jest zażegnane rotacją i GitHub
takiej prośby nie realizuje. Wcześniejsza notatka w tym miejscu twierdziła, że
„robią to bez dyskusji" — to było powtórzone przekonanie, nie sprawdzony fakt.

Stan faktyczny, dla porządku:

- blob jest nieosiągalny z jakiejkolwiek gałęzi i tagu, ale nadal dawał się
  pobrać po SHA (sprawdzone 2026-09-03);
- po upublicznieniu repozytorium (2026-09-04) może go pobrać każdy, **kto zna
  jego SHA** — a SHA nie da się zgadnąć ani wyklikać, i nie ma go w żadnym
  publicznym odnośniku;
- zawiera **wyłącznie** stary, wymieniony PIN konta SQ8BWA, dwa razy. PIN-u
  SQ8BWM tam nie ma, innych sekretów też nie;
- 0 forków i 0 otwartych pull requestów, więc nic tego nie rozprzestrzenia.

Jedyna droga z gwarancją to skasowanie i odtworzenie repozytorium — a to dziś
znaczy utratę publicznego adresu i czterech wydań z pobraniami. Nieproporcjonalne
do martwych bajtów.

**Wniosek na przyszłość zostaje ten sam i jest jedyną rzeczą, która tu naprawdę
działa: nie commitować surowych logów pracy.** Log mostka pokazuje ładunki żądań
razem z PIN-ami celów. Od 0.1.10 tryb próbny PIN-u już nie zapisuje, a `*.log`
jest w `.gitignore`.

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

### Dymki nieosiągalne na telefonie — NIE naprawiamy

Zauważone 2026-09-08: ocena celów rozgałęziania to mały znacznik (`✓`, `•`, `!`)
z całym wyjaśnieniem w atrybucie `title`, czyli w dymku po najechaniu myszką.
Dotyk nie ma najechania, więc z telefonu tej treści nie da się przeczytać.
To samo dotyczy dymków kart liczników, ikony kłódki i plakietki stanu.

**Decyzja autora (2026-09-08): nie zajmujemy się tym.** Powód: ta sama
informacja jest w LOGU, i to zwięźle — a log jest dostępny również z telefonu,
w zakładce Log. Szczegóły są w dokumentacji, a do konfigurowania celów i tak
siada się przy komputerze.

Gdyby kiedyś wracać: rozwiązaniem NIE jest wypisanie tekstu na stałe pod każdym
wierszem — przy pięciu celach zrobiłoby to ze formularza ścianę. Raczej
kliknięcie znacznika rozwijające wyjaśnienie tylko dla tego wiersza.

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

**Pytanie zadane autorowi serwisu 2026-09-03** (razem z pytaniem, czy pole
`operator` jest w ogóle walidowane). Czekamy na odpowiedź — nie zgadujemy dalej.

## Funkcjonalne

### Wykorzystanie API do walidacji — czekamy na dwie zmiany w serwisie
Autor serwisu **rozszerzył API 2026-09-04** (`stations`, `activeActions`,
`pinExpires`, `apiEnabled` w `PING`/`STATUS`, plus `action=VALIDATE`).
Sprawdzanie konfiguracji **jest już zrobione** — patrz
[docs/konfiguracja.md](docs/konfiguracja.md#sprawdzanie-konfiguracji-wobec-konta-od-019).

Zgłoszenie **wysłane 2026-09-04**, czekamy na odpowiedź. Zmierzone i zgłoszone,
blokuje dalsze kroki:

1. **`is_validation_only` tylko przy sukcesie.** Gdy walidacja stwierdza, że QSO
   nigdzie nie wejdzie, odpowiedź jest bajt w bajt taka jak przy nieudanym
   PRAWDZIWYM zapisie — a to właśnie ten przypadek jest wart sprawdzania.
   Dopóki tak jest, nie użyjemy VALIDATE do przycisku „sprawdź to QSO".
2. **Brak `reason`.** „Stacja bez uprawnień" i „data poza zakresem akcji" dają
   identyczny komunikat, więc nie da się użytkownikowi powiedzieć, co poprawić.
   Poprosiliśmy o `NO_STATION_RIGHTS` / `NO_ACTIVE_ACTION` / `ACTION_CLOSED` /
   `WOULD_BE_DUPLICATE`, przy VALIDATE i przy zwykłym zapisie.

Dwie mniejsze prośby w tym samym zgłoszeniu: `INVALID_CALLSIGN` wraca dla trzech
różnych pól (korespondent, stacja, operator) i rozróżnia je tylko polski tekst —
prosiliśmy o `field` albo osobne kody; `savedTo: []` przy `success: true` nadal
nie ma kodu błędu.

Otwarte pytania do autora: czy `PING` wchodzi w limit 10/min razem z zapisami
(dziś zakładamy ostrożnie, że tak — cudze konta odpytujemy tylko na starcie
i po zapisie), oraz czy `PING` i `STATUS` mają celowo zwracać to samo.

**Ustalone przy okazji:** PIN nie ma daty ważności (`pinExpires: null`) poza
banem/blokadą konta. Nie można logować do akcji zakończonej dawniej niż 7 dni —
to dotyczy naszego ponawiania: QSO leżące długo w `failed/` może już nie wejść.
Pole `operator` jest walidowane jako znak krótkofalarski (max 15 znaków,
ucinane), z żadną listą nie jest wiązane.

### Ostrzeżenie o złym znaku operatora — bez własnego wzorca znaku
Pole `operator` jest walidowane przez serwis jako znak krótkofalarski: wartość
niebędąca znakiem odbija QSO (`INVALID_CALLSIGN`, HTTP 400), a dłuższa niż
15 znaków jest po cichu **ucinana**. Dziś mostek wysyła to bez ostrzeżenia.

**Nie piszemy własnego wzorca znaku.** Ustalone 2026-09-04, po pytaniu „jak
chcesz rozpoznawać zły znak":

- Regexa serwisu nie znamy. Każda reguła strukturalna (prefiks litera+cyfra,
  długość sufiksu) ma dziesiątki wyjątków: znaki okolicznościowe, `/P`, `/MM`,
  `3Z0X`. Autor serwisu wprost mówi, że przechodzą `SP1ZOSIA` i `SP1BLABLABLA`.
- Koszty są niesymetryczne: uznanie poprawnego znaku za zły to zablokowane albo
  opóźnione QSO, a przepuszczenie złego to jedno odbicie do `failed/`, ratowane
  jednym kliknięciem. Surowość jest więc droższa od pobłażliwości.

Co robić, w kolejności wartości:

1. **Znaki poza `A–Z`, `0–9`, `/`** — ostrzegać. To jedyne, co zmierzyliśmy jako
   odrzucone (`NIE ZNAK!` — spacja i wykrzyknik).
2. **Dłuższe niż 15 znaków** — ostrzegać, i to jest ważniejsze od punktu 1:
   serwer nie odrzuca, tylko ucina, więc QSO zapisuje się pod **innym**
   operatorem niż zamierzony, bez żadnego sygnału błędu.
3. **W polu „Operator" w oknie konfiguracji** surowość jest bezpieczna —
   wpisuje je człowiek, więc pytanie przy zapisie (jak przy znakach stacji) to
   czysty zysk. Nic nie leci, nic nie ginie.
4. **Dla wartości z loggera — żadnej blokady wysyłki.** Tylko wpis w zdarzeniach
   i w logu.

**Docelowo właściwe rozwiązanie:** nie odtwarzać reguł serwisu, a zapytać go
przez `action=VALIDATE`. To jedyne źródło prawdy o tym, co przyjmie. Czeka na
`is_validation_only` na ścieżce odrzucenia — patrz pozycja o walidacji wyżej.

### Interfejs w sieci: zewnętrzny adres, HTTPS i logowanie — ZROBIONE w 0.1.15

Zamówione 2026-09-07, zrobione tego samego dnia. Opis dla użytkownika:
[docs/interfejs-w-sieci.md](docs/interfejs-w-sieci.md).

Co powstało, w kolejności ustalonej wcześniej:

1. **`api.host`** — domyślnie `127.0.0.1`, zmiana wymaga restartu.
2. **Tryb tylko do odczytu domyślny w sieci** (`api.readOnly`). Zapis wymaga
   jawnego `false` — wtedy każdy, kto zna hasło, może zmienić PIN.
3. **Hasło** — `scryptSync` z `node:crypto`, porównanie `timingSafeEqual`,
   hasz w konfiguracji, nigdy jawne hasło. Blokada po pięciu nieudanych próbach
   z jednego adresu, z podwajaniem kary do 15 minut; dotyczy też prawidłowego
   hasła, inaczej byłaby bez sensu.
4. **CSRF** — token w nagłówku `X-CSRF-Token`, wydawany po zalogowaniu i trzymany
   tylko w pamięci strony. Ciasteczko sesji: `HttpOnly`, `SameSite=Strict`,
   `Secure` przy TLS.
5. **TLS** — `node:https`, certyfikat własny wystawiany przy pierwszym starcie
   w tym trybie, do `<dane>/tls/` z prawami `0600`. Wystawia `openssl`, gdy jest
   w systemie, a gdy nie ma — wbudowany koder DER (`src/cert.js`, od 0.1.21).
   Odcisk SHA-256 w logu do porównania w przeglądarce.

**Fail-closed jest tu regułą, nie ozdobą:** brak hasła albo TLS-a = nasłuch
zostaje na `127.0.0.1` i program mówi w logu dlaczego. Sprawdzone testem
i doświadczalnie na uruchomionym programie.

Zero nowych zależności i — od 0.1.21 — zero oparcia o zewnętrzne narzędzia:
`openssl` jest używany, gdy jest, ale nie jest wymagany. Node umie X.509 tylko
czytać, więc wystawianie robi własny koder DER.

Przepis na odwrotne proxy został w dokumentacji jako droga dla tych, którzy
mają je już postawione — bez rekomendowania go przeciętnemu użytkownikowi.

**Czego świadomie NIE zrobiliśmy:** certyfikatów od Let's Encrypt (wymaga
publicznej nazwy i przekierowania portu, czyli wystawienia shacku do internetu),
kont wieloosobowych (jedno hasło wystarcza na stację) i trwałych sesji
(restart = ponowne logowanie; trwałe trzeba by unieważniać przy zmianie hasła).

### Interfejs responsywny — etap 1 ZROBIONY w 0.1.25

Zamówione 2026-09-08, po pierwszym wejściu z telefonu na interfejs w sieci
lokalnej. Wybrana droga: **responsywny** (jeden układ z punktami załamania),
nie adaptacyjny — bo cały interfejs stał już na `auto-fit` i `flex-wrap`, więc
osobny widok byłby drugim źródłem prawdy bez zysku.

**Przyczyna okazała się banalna:** w `index.html` nie było `<meta viewport>`,
więc przeglądarka na telefonie rysowała stronę jak na ekranie 980 px
i pomniejszała całość. Sam viewport nie wystarcza (bez punktów załamania
elementy zaczynają wystawać w bok), więc obie rzeczy poszły razem, plus:
zakładki w jednym przewijanym rzędzie, `.two`/`.three` do jednej kolumny,
16 px w polach (inaczej telefon przybliża widok przy wejściu w pole), tabele
w opakowaniu przewijanym w poziomie, mniejsze odstępy.

Sprawdzone zrzutami przy 380, 600 i 900 px: liczniki po dwa w rzędzie,
Konfiguracja jednokolumnowa, biurkowe 900 px bez zmian. Osiem testów pilnuje
kontraktu (m.in. tego, że viewport i `@media` istnieją RAZEM i że próg nie
dochodzi do szerokości okna).

**Etap 2 — ZROBIONE 2026-10-02.** Tabele Kolejki są na telefonie kartami
„etykieta: wartość". Pytanie „czy w ogóle przeszkadza" rozstrzygnął pomiar na
prawdziwym oknie przy 390 px (Xvfb, instancja z własnym `RD_CONFIG_DIR`):
przewijana w bok tabela ucinała OSTATNIĄ kolumnę, czyli powód — `sieć:
ETIMEDOU…`, `NOT_SAVED: bra…`. Widać było, ŻE QSO odpadło, ale nie dlaczego,
a to jedyny powód, dla którego otwiera się tę zakładkę z telefonu.

Etykiety kart biorą się z nagłówków tej samej tabeli (`data-label` dokładane
w `fillTable`), więc tłumaczenia nie ma w drugim miejscu. `display:block` gubi
semantykę tabeli, dlatego role ARIA (`table`, `rowgroup`, `row`, `columnheader`,
`cell`) są wpisane wprost w znaczniki, a nagłówek jest ukryty wizualnie
(`position:absolute` + `clip-path`), NIE przez `display:none` — inaczej
zniknąłby też z drzewa dostępności. Na monitorze wygląd bez zmian.

### Powiększanie widoku — ZROBIONE w 0.1.26, dostępność szerzej otwarta

Zamówione 2026-09-08 jako „wersja dla niedowidzących, z większą czcionką".
Zrobione BEZ osobnej wersji — jeden interfejs, który się skaluje, bo drugi
byłby drugim źródłem prawdy.

Co jest: powiększanie okna (Ctrl +/-/0, szczypanie), skala czcionki z ikony
w nagłówku (trzy stopnie), wszystkie rozmiary w `rem` — czyli program szanuje
ustawienie systemowe, które wcześniej ignorował — kontrasty w motywie jasnym
dobrane pomiarem do 4,5:1 i widoczny focus na wszystkim klikalnym.

Świadomie odrzucone po zobaczeniu zrzutów: podniesienie najmniejszych podpisów
z 11 na 12 px. Łamało dwa z pięciu podpisów kart na dwie linie i podwyższało
rząd liczników — koszt estetyczny za mały zysk. Rozmiary są w `rem`, więc i tak
rosną razem ze skalą i z ustawieniem systemowym.

**Czego NIE ma, a należy do dostępności** (do rozważenia, nie zamówione):

- **czytnik ekranu** — ikony nagłówka mają `aria-label`, ale nie sprawdzaliśmy
  całości: kolejności czytania, opisów pól formularza, komunikatów o zmianie
  stanu (`aria-live` przy licznikach i banerach),
- **nawigacja klawiaturą** — focus jest teraz widoczny, ale nie sprawdzaliśmy,
  czy da się dojść do wszystkiego bez myszki (zakładki, dialogi, wiersze
  rozgałęzień),
- **tryb wysokiego kontrastu** systemu (`prefers-contrast`) — dziś nieobsługiwany,
- **ograniczenie animacji** (`prefers-reduced-motion`) — nie mamy animacji poza
  przewijaniem, więc prawdopodobnie nic do zrobienia; do potwierdzenia.

### Rozgłoszenie programu — zaczęte 2026-09-30

Do 30.09 program był nieznany: **62 pobrania łącznie**, z czego wszystkie wyglądają
na nasze własne testy, **0 pobrań** wydań 0.1.25–0.1.29, 0 odsłon repozytorium,
0 gwiazdek. Marek: „chyba nikt nie używa naszej wspaniałej aplikacji".

Zrobione tego dnia:

- **Wpis na stronie Puławskiej Grupy Krótkofalowców** —
  <https://krotkofalowcy.pulawy.pl/radiodyplom-bridge/> (wpis 4662, konto SQ8BWM,
  kategorie Akcja dyplomowa i Klub, trzy zrzuty z 0.1.29). Źródło treści leży
  w katalogu projektu strony: `wpis-radiodyplom-bridge.html`.
- **Post na Facebooku** — wrzucony przez Piotra SP8X z naszym opisem
  (`wpis-radiodyplom-bridge-facebook.txt`, wersja główna).
- **README poprawione**: świeże zrzuty i przepisana sekcja „Do czego to jest".

**Ważne ustalenie merytoryczne, które zmieniło cały przekaz:** alternatywą dla
mostka NIE jest wgrywanie ADIF-a, tylko wpisywanie QSO wprost na radiodyplom.pl
w przeglądarce. Prawdziwa wartość to swoboda pracy we własnym loggerze plus dwie
rzeczy niemożliwe inaczej — kilka znaków stacji naraz i emisje cyfrowe.
Dokumentacja twierdziła inaczej i to ona wprowadzała w błąd.

**Punkt odniesienia (30.09, ok. godzinę po publikacji):** 555 odsłon artykułu,
**1** pobranie nowych wydań. Proporcja odsłon do pobrań jest tu liczbą do
obserwowania: jeśli po kilku dniach będzie 2000 odsłon i 5 pobrań, problem nie
leży w widoczności, tylko w tym, co widać PO kliknięciu (wpis, README, strona
wydań z sześcioma plikami do wyboru).

**Odłożone:** mail do Tobiasza (autora radiodyplom.pl) z prośbą o kafelek
w Managerze i stronę o mostku w serwisie — draft gotowy, ale API serwisu nie ma
dziś innych klientów poza nami, więc kanał jest wąski. Decyzja: poczekać na
wynik Facebooka. Gdyby wracać do tematu: wejściem ma być strona W SERWISIE
(a generowanie PIN-u krokiem w jej środku, nie odwrotnie), a argumentem dla
autora to, że jego wrześniowe rozszerzenie API dostaje wreszcie klienta.

### Statystyki — zrobione, co jeszcze warto dołożyć
Zakładka i importer historii gotowe w 0.1.10 —
[docs/statystyki.md](docs/statystyki.md). Historia z logów wczytana: 1114 kopii,
372 QSO, 31.08–03.09 (z 1119 wpisów logu odsiane 2 przejścia próbne i 3 kopie
QSO testowego `SN0TEST`).

Do rozważenia, gdy pojawi się potrzeba:

- **Eksport do CSV/ADIF** — dziennik jest w JSON Lines, więc to kilka linii kodu.
- **Wykres w czasie** zamiast listy pasków; dziś przy 14 dniach lista wystarcza.
- **Porównanie z serwisem** — ile QSO widzi radiodyplom na danej akcji. Wymaga
  endpointu, którego nie ma; sensowne dopiero razem z resztą zapytania do autora.
- **Wygasanie dziennika.** Przy tempie 300 QSO/dzień to ~1 MB na miesiąc, więc
  jeszcze długo nie problem. Podział na pliki miesięczne jest już zrobiony, więc
  usuwanie starych będzie trywialne.

### Wrzucanie spotów — pomysł, nie zamówienie
Zgłoszone 2026-09-04 jako „może kiedyś". Nic nie było jeszcze ustalane, więc
zapisuję tylko to, co trzeba będzie rozstrzygnąć NA POCZĄTKU, żeby nie zacząć
od budowania złej rzeczy:

- **Gdzie spotować.** Klaster DX (telnet, protokół tekstowy), SOTAwatch/POTA
  (HTTP), czy radiodyplom, gdyby dorobił u siebie spoty? To trzy różne
  rozwiązania i różne dane logowania.
- **Kogo spotować: siebie czy korespondenta.** Aktywator spotuje siebie
  („jestem na 7.144"), a to znaczy, że dane NIE pochodzą z QSO, tylko ze
  stanu radia albo z ręcznego wpisu. Kolejka QSO jest tu bez znaczenia.
- **Czy z automatu.** Spot po każdym QSO to zaśmiecanie klastra; realnie
  potrzebne jest „wrzuć spot teraz" na żądanie albo po zmianie pasma.

Loggery wysyłają nam tylko zalogowane QSO, więc częstotliwość bieżąca jest
znana wyłącznie wtedy, gdy właśnie coś zalogowano. Jeśli spot ma być
niezależny od QSO, trzeba będzie osobnego źródła (CAT z radia albo pole
w oknie) — i to jest największa nieznana tej pozycji.

### QLog wysyła DWA datagramy na jedną edycję — zmierzone, zamknięte
**Rozstrzygnięte 2026-09-04 pomiarem.** Jedna poprawka rekordu w QLogu daje
**dwa** datagramy z `operation: "update"`.

Dwie niezależne obserwacje, zgodne:

| Czynność operatora | Datagramy pominięte |
|---|---|
| 2 poprawki (z pamięci) | 4 |
| **1 poprawka (kontrolowana)** | **2** |

Zamyka to rozbieżność, która wyszła przy pierwszym pytaniu: okno pokazywało
4 pominięcia, a operator pamiętał dwie edycje i żadnego usunięcia. Wszystko się
zgadza — **datagram nie jest tym samym co czynność użytkownika**.

Wniosek na przyszłość: licznik pominięć liczy **datagramy** i tak ma być, bo to
one przychodzą na port. Ale przy czytaniu liczby trzeba pamiętać o mnożniku,
i dlatego jest o tym podpowiedź w oknie oraz wzmianka w `docs/loggery.md`.

Nie sprawdzone i na razie bez potrzeby: czy `delete` też daje dwa datagramy
i czy inne loggery mają podobne zachowanie.

### Windows 7 i 8 — nie obsługujemy i nie da się
Zgłoszone 2026-09-05: na 64-bitowym Windows 7 program nie startuje ani
zainstalowany, ani przenośny — *„nie jest prawidłową aplikacją systemu Win32"*.
To komunikat systemu, nie programu; Windows odmawia wczytania pliku, zanim nasz
kod wystartuje.

Sprawdzone w README samego Electrona, nie z pamięci:

| | |
|---|---|
| Electron 22 | `Windows (Windows 7 and up)` — ostatni, bez wsparcia od X 2023 |
| Electron 23+ | `Windows (Windows 10 and up)` |
| u nas | 44 |

**Tryb bez okna też nie ratuje**: Node 16 wymaga Windows 8.1, Node 18+ wymaga
Windows 10 (tabela w `BUILDING.md` Node'a). Nasz kod używa `AbortSignal.timeout`
i ustawień Happy Eyeballs, czyli rzeczy nowszych niż Node 16.

Budowa na Electronie 22 odpada: Chromium bez łatek od dwóch lat plus
przepisywanie kodu pod stary Node. Nieproporcjonalne i szkodliwe.

**Rozwiązanie dla użytkownika:** mostek na innej maszynie w tej samej sieci,
logger wysyła UDP przez sieć. Opisane w
[docs/windows-i-siec.md](docs/windows-i-siec.md#windows-7-i-8--program-się-nie-uruchomi),
a od 0.1.13 jest do tego gotowy pakiet bez interfejsu
([docs/malinka.md](docs/malinka.md)) — 120 kB, `Architecture: all`, usługa systemd.

**Nasza wina była jedna i już naprawiona:** nigdzie nie było napisane, jakiego
Windowsa program wymaga. Użytkownik pobierał i dostawał komunikat, z którego nic
nie wynika.

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

**Nie jest to kwestia teoretyczna, choć autostartu nie robimy** (decyzja wyżej).
Powód jest inny i już realny: **pakiet headless z 0.1.13 działa jako usługa
systemd**, a `systemctl stop` to dokładnie `SIGTERM`. Tam zasobnika nie ma, więc
nie o ikonę chodzi — ale kolejka i dziennik zasługują na czyste domknięcie
zamiast ubicia procesu. Do sprawdzenia:
`app.on('will-quit')`, `powerMonitor`, ewentualnie proces nadzorujący, który woła
`app.quit()` przez IPC zamiast wysyłać sygnał.

Na czas testów jest `RD_NO_TRAY=1` (start bez ikony). Uwaga: zmienna musi dotrzeć
do samego procesu Electrona — przy `xvfb-run` potrafi się zgubić.

### Autostart — NIE robimy
**Decyzja (2026-09-07).** Program nie będzie się uruchamiał z systemem.
Zostaje `docs/windows-i-siec.md` jako opis dla kogoś, kto sam tego chce
(Harmonogram zadań / systemd), ale opcji w instalatorze ani
`app.setLoginItemSettings()` nie dodajemy.

Powód, żeby nie wracać: **włączenie mostka musi być świadomym krokiem**, bo
przekazywanie QSO jest nieodwracalne — wysłane QSO trafia do cudzego dziennika
akcji i nie da się go „odwysłać".

Rozstrzyga proporcja: akcje dyplomowe są **od czasu do czasu**, a logowanie
lokalne odbywa się **znacznie częściej**. Mostek startujący z systemem stałby
więc bezczynnie przez większość dni — a w te dni czekałby z włączonym celem na
QSO, które nie należą do żadnej akcji.

Rozważony wariant „start zawsze wstrzymany" odrzucony jako pozorny: skoro i tak
trzeba kliknąć, żeby ruszył, to autostart nie oszczędza kroku, a dokłada proces
w tle i pytanie „czy on teraz nasłuchuje, czy nie".

**Wzmacniało to inną potrzebę: widoczności, którym znakiem stacji poleci QSO —
ZROBIONE w 0.1.19.** Zakładka Stan ma panel „Poleci jako" (włączone cele wraz
z operatorem, liczba wyłączonych albo wprost „ze znakiem z loggera"), a do tego
ostrzeżenie, gdy ŻADEN włączony cel nie loguje na znak przychodzący z loggera.
Warunek jest właśnie taki, a nie „znaki się różnią": przy rozmnażaniu QSO na
kilka stacji rozjazd jest normalny i zamierzony, więc ostrzeganie o nim zawsze
zrobiłoby z tego szum, który się ignoruje.

To była osobna sprawa od ostrzeżenia o **złym znaku operatora** (niżej): tam
chodzi o wartość, której serwis nie przyjmie albo ją utnie, tutaj o poprawny
znak użyty w niewłaściwym momencie. Zapisane omyłkowo jako jedno 2026-09-07.

### Aktualizacje aplikacji — powiadomienie zrobione, samoaktualizacji NIE robimy
Od 0.1.11 program sprawdza, czy jest nowsze wydanie, i mówi o tym w oknie
(odznaka + zakładka „O programie"). Nie pobiera i nie instaluje niczego sam.

**Samoaktualizacji świadomie nie wprowadzamy**, ustalone 2026-09-04:

1. Mostek pracuje godzinami w trakcie akcji. Restart przerywa nasłuch UDP,
   a QSO wysłane przez logger w tym oknie **nie ma jak wrócić** — UDP nie
   ponawia. To jedyny powód, który wystarcza sam.
2. Objęłaby dwie postacie z czterech: `latest.yml` opisuje wyłącznie instalator
   NSIS, `latest-linux.yml` wyłącznie AppImage (sprawdzone w wygenerowanych
   plikach). `.deb` i wersja przenośna i tak zostają z powiadomieniem.
3. Bez podpisu kodu pobrany instalator trafi na SmartScreen.

Gdyby kiedyś wracać do tematu: `electron-updater` + sekcja `publish`
w `electron-builder.yml` + wgrywanie `latest*.yml` do wydania (dziś ich NIE
wgrywamy) — i twarda reguła „nigdy nie restartuj sam, tylko zaproponuj po
zamknięciu".

Repozytorium `apt` dla `.deb` byłoby „właściwą" drogą dystrybucji, ale to własny
serwer albo PPA, klucze GPG i utrzymanie — nieproporcjonalne do skali.

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
- **Lista stacji przychodzi TYLKO w trakcie akcji** (rozstrzygnięte
  2026-09-08). Ta sama pomyłka siedziała w DWÓCH miejscach: w panelu konta
  (0.1.27) i w sprawdzaniu celów rozgałęziania (0.1.28) — tam była gorsza, bo
  pusta lista dawała stan BLOKUJĄCY („kopie wrócą jako NOT_SAVED") przy
  poprawnej konfiguracji. Rozstrzyga kolejność sprawdzeń: najpierw „lista jest
  pusta", potem „czy jest na niej ten znak". Poza akcją serwis oddaje pustą listę, a nasz komunikat brzmiał
  „brak — konto nie ma przypisanej żadnej stacji", czyli jak awaria konta —
  i niepokoił bez powodu przez kilka dni. Potwierdzone doświadczalnie: po
  założeniu akcji próbnej komunikat zniknął, a stacje się pokazały. Od 0.1.27
  panel rozróżnia trzy rzeczy: serwis nie podał (starsze API), pusto poza akcją
  (spokojna podpowiedź) i pusto W TRAKCIE akcji (ostrzeżenie, bo wtedy nie ma
  na co logować i QSO wrócą odrzucone).
- **Logger32 — potwierdzony na żywym programie** (2026-09-30, Windows,
  Logger32 4.0.344). Cała droga: rekord ADIF po TCP → rozpoznanie → znak stacji
  z pola OPERATOR → mapowanie na pola radiodyplom → kolejka → tryb próbny.
  Ustalenia, których nie dało się wyczytać z dokumentacji Logger32:
  **nie wysyła `STATION_CALLSIGN`** (znak stacji to u niego `OPERATOR`, tak samo
  rozumie to jego własna instrukcja), numeruje QSO polem
  `APP_LOGGER32_QSO_NUMBER`, a po skonfigurowaniu eksportu trzeba jeszcze
  kliknąć **„Click to Open socket"** — bez tego wszystko wygląda na ustawione
  i nic nie leci. Raporty sprawdzone osobno: `59` na wejściu daje `59` na
  wyjściu (pierwsze QSO miało wpisane pojedyncze cyfry, nie był to błąd
  parsera). Test na prawdziwym rekordzie, wklejonym bajt w bajt, jest w
  `test/logger32.test.js`.
  **Domknięte tego samego dnia:** po aktywowaniu akcji próbnej QSO z Logger32
  przeszło z WYŁĄCZONYM trybem próbnym i zostało zapisane w akcji. Cała droga
  — od rekordu ADIF po TCP aż po wpis na serwerze — jest więc sprawdzona na
  żywym programie, nie na symulatorze.
- Duplikaty są zapisywane i oznaczane jako niepunktowane, nie odrzucane.
- Automatyczne dosyłanie po awarii łączności działa bez ingerencji.
- Sekrety nie trafiają do paczek (sprawdzone przez rozpakowanie `app.asar`).
- Dwie instancje nie zajmą jednego portu UDP ani jednego katalogu danych.
- Przełączalny język PL/EN — słownik `ui/strings.js`, wybór zapamiętywany,
  błędy API tłumaczone po kodzie. Zweryfikowane zrzutami w obu językach.
- Cel `.deb` włączony (opiekun: `author` z `package.json`).
- **PIN przy celu rozgałęziania i znacznik „Aktywna"** (2026-09-03). Model
  ustalony ostatecznie: PIN należy do KONTA, a serwer sprawdza wyłącznie
  `station_callsign` — `operator` jest polem opisowym i nie jest weryfikowany.
  **Uzupełnione 2026-09-08 na żywej akcji:** sprawdzenie idzie wobec TRWAJĄCEJ
  AKCJI, nie tylko wobec konta. Dwa warunki naraz: stacja **dodana do akcji**
  (ustawia organizator) ORAZ **dodana do konta**, z którego leci QSO. Konto
  z zaznaczonym „mogę logować jako wszystkie stacje" NIE mogło logować na
  `SN8N`, bo `SN8N` nie był dodany do akcji. Serwis oddaje w obu przypadkach to
  samo (`savedTo: []`), więc program nie rozdziela tych przyczyn i wymienia oba
  warunki. Dlatego PIN przy celu jest potrzebny tylko
  wtedy, gdy stacja nie jest przypisana do własnego konta. Bez bazy użytkowników:
  jedno pole przy regule wystarcza.
  PIN celu ma cztery stany (nieprzysłany / zamaskowany / nowy / pusty), bo bez
  rozróżnienia „nie przysłano" od „przysłano puste" klient nieznający tego pola
  po cichu kasowałby cudze PIN-y. Usunięcie jest za potwierdzeniem.
  Znacznik `enabled` wyłącza regułę **bez utraty danych**; wyłączenie wszystkich
  zachowuje się jak brak reguł (jedno QSO ze stacją z loggera), a nie jak brak
  wysyłki. 220 testów; trzy mutacje wywalają właściwe testy.
- **Test słownika po raz drugi udowodnił swoją wartość**: przy dodawaniu etykiet
  te same klucze znów trafiły dwa razy do bloku polskiego (linia
  `'hint.targetIncomplete':` jest identyczna w obu językach). Wyłapane od razu,
  zamiast na zrzucie ekranu jak poprzednio.
- **Okno logu: nie dało się czytać ani nie rosło z oknem.** Skok na koniec był
  bezwarunkowy, więc każde odświeżenie (co 2 s) wyrywało widok z powrotem;
  wysokość pola była wpisana na sztywno (460 px). Teraz: przewijanie za logiem
  tylko wtedy, gdy widok JEST na końcu, plus wskaźnik stanu i przycisk „Na
  koniec"; przy niezmienionej treści DOM nie jest ruszany wcale. Wysokość
  liczona z faktycznego położenia pola (`fitLogBox`), bo `flex` na całym
  układzie powodował przewijanie strony zamiast logu, a sztywne odejmowanie
  rozjeżdżało się przy zawiniętym nagłówku. Długie linie JSON łamane
  (`overflow-wrap:anywhere`) — koniec z poziomym paskiem.
- **Cały łańcuch obsługi odrzuconych potwierdzony w prawdziwej pracy** (2026-09-02,
  0.1.7): QSO na stację `SQ8BWA` wróciło jako odrzucone i było to widoczne od razu
  — czerwony wiersz w zdarzeniach i plakietka. Po dopisaniu stacji do listy konta
  w Managerze i kliknięciu „Ponów odrzucone" łączności przeszły. Czyli: sygnalizacja
  pokazała problem, komunikat wskazał przyczynę, a ponowienie odzyskało QSO.
- **PIN konta SQ8BWA wygenerowany od nowa** (2026-09-02) po znalezieniu starego
  w plikach `.swp` w historii gita. Stary PIN jest bezwartościowy, sprawa zamknięta.
- **„Ponów odrzucone" w trybie próbnym po cichu wyrzucało QSO** — przechodziły
  „na sucho", nie leciały na serwer, a mimo to znikały z kolejki i wracały do
  deduplikacji. Czyli przycisk, którym się ratuje łączności, kasował je.
  Zauważone przez operatora po zobaczeniu wierszy „próbnie — NIE wysłane"
  („czy to ok?"). Teraz przy włączonym trybie próbnym program pyta wprost,
  zanim cokolwiek ruszy.
- **„Ponów odrzucone" nic nie robiło** — pomijało QSO odrzucone przez serwer,
  bo są w zbiorze deduplikacji, i milczało o tym. Zgłoszone jako „nie reaguje
  na kliknięcie". Teraz przywraca WSZYSTKO, uwalniając klucze (trwale, bo
  restart przywróciłby blokadę), i mówi, ile wróciło albo że nie było czego.
  Sens: NOT_SAVED z powodu znaku poza listą konta przestaje być prawdą po
  poprawieniu uprawnień w Managerze. Dwa testy z odwróconą regułą, jeden
  na trwałość uwolnienia klucza.
- **Trzy przyciski odrzuconych w jednym miejscu** (zakładka Kolejka): ponowienie,
  wyczyszczenie sygnalizacji, usunięcie. „Ponów odrzucone" zeszło z nagłówka —
  tam zostały tylko język, „Wstrzymaj" i „Zakończ". Plakietka „PROBLEMY" znów
  tylko przenosi na Kolejkę: w nagłówku obok stoi „Zakończ", więc nie może tam
  być akcji działającej od jednego kliknięcia. Komunikat o wyniku akcji gaśnie
  po 12 s, żeby po czasie nie wprowadzał w błąd.
- **„Zakończ" lądował pod plakietkami w nagłówku** przy wąskim oknie i dało się
  go trafić, celując w plakietkę problemów — co realnie się stało przy próbach.
  Przyciski nagłówka są teraz jedną grupą (zawijają się razem, nie pojedynczo)
  i po zawinięciu trzymają się prawej krawędzi, a „Zakończ" jest odcięty
  separatorem. Sprawdzone zrzutami przy 920 i 1200 px.
- **Usuwanie odrzuconych QSO** — przycisk w panelu Odrzucone, na wypadek gdy są
  to łączności błędne i nie ma czego ratować. Jedyna akcja w programie, która
  trwale niszczy dane, więc: potwierdzenie z liczbą i zdaniem „TEGO NIE DA SIĘ
  ODWRÓCIĆ", a **każde usunięte QSO wypisane w pliku logu** (znak, stacja, kod,
  klucz). Po usunięciu poziom potwierdzenia zjeżdża do zera, więc następne
  odrzucenie znów zapala plakietkę. Sprawdzone w oknie, z zatwierdzeniem
  okienka: 4 QSO zniknęły, w logu został pełny ślad.
- **Tryb próbny podpisywał QSO jako „wysłane"** — bez numeru akcji, choć nic nie
  opuszczało komputera. Zauważone przez operatora na liście zdarzeń („dlaczego
  trzy ostatnie nie mają numeru akcji?"). Teraz osobny rodzaj zdarzenia
  („próbnie — NIE wysłane", żółty) i etykieta licznika „Wysłane (próbnie)".
  Przy okazji podpisana pułapka: QSO przepuszczone próbnie zostaje zamknięte
  w deduplikacji i NIE poleci po wyłączeniu trybu — do przytrzymania QSO służy
  „Wstrzymaj". Podpowiedź na plakietce DRY-RUN i sekcja w docs/interfejs.md.
- **Lista ostatnich zdarzeń** zamiast dwóch pojedynczych linii: bufor 200 zdarzeń
  w rdzeniu, liczba wierszy z konfiguracji (`ui.recentEvents`, 5–200, domyślnie 20,
  przycinana po obu stronach). Wiersze z problemem czerwone, ponowienia żółte,
  duplikaty wyblakłe.
- **Sygnalizacja problemów** — plakietka „PROBLEMY: n" obok DRY-RUN, gdy są
  odrzucone QSO, których użytkownik jeszcze nie potwierdził. Wynika z RÓŻNICY
  między zawartością `data/failed/` i trwale zapisanym `ackedFailed`
  w `seen.json`, więc przeżywa restart. Kasowanie kliknięciem plakietki
  (z potwierdzeniem) albo przyciskiem w panelu Odrzucone; kasuje samą
  sygnalizację, QSO zostają. 10 testów.
- **Pierwsza wersja sygnalizacji trzymała licznik w pamięci workera** — i to był
  błąd wprost przeciwny jej celowi: w spakowanej aplikacji rdzeń żyje w tym samym
  procesie co okno, więc zamknięcie programu kasowało ostrzeżenie, choć odrzucone
  QSO zostawały na dysku. Zgłoszone przez operatora: „w dymku jest 4 odrzucone
  QSO, a nie ma odrzuconych; nie da się na to kliknąć i zresetować". Przy okazji
  domknięta pułapka arytmetyki: po „Ponów odrzucone" poziom potwierdzenia musi
  zostać przycięty w dół, inaczej następne odrzucenie byłoby przemilczane.
- **Trasy lokalnego API nie miały testów** — `/api/problems/ack` rzucała
  „json is not defined" i cały zestaw przeszedł, bo żaden test nie dotykał
  warstwy HTTP. Doszło 8 testów przechodzących po wszystkich trasach.
- **Zakładka „O programie"** — wersja, autor, licencja i zdanie o braku gwarancji,
  plus odnośniki do licencji, repozytorium i wydań. Nic nie jest wpisane na sztywno:
  dane idą z `package.json` przez `/api/status`, więc wersja w oknie nie może
  rozjechać się z nazwą instalatora. Odnośniki otwiera przeglądarka systemowa,
  a uchwyt IPC przepuszcza wyłącznie `https://`.
- **Nagłówki licencyjne** w 42 plikach źródłowych, w formie SPDX (dwie linie,
  czytelne dla ludzi i dla narzędzi). Shebang i `<!doctype>` zostały pierwsze.
- **Zdublowany klucz w słowniku UI** — przy dodawaniu zakładki ten sam klucz
  trafił dwa razy do bloku polskiego (linia `'tab.log': 'Log',` jest w obu
  językach identyczna), więc polski interfejs pokazywał angielską etykietę.
  Bezgłośnie: w obiekcie JS wygrywa ostatni wpis. Widać to było dopiero na
  zrzucie ekranu. Doszło 7 testów słownika czytających plik jako TEKST —
  po sparsowaniu obiektu duplikatu nie da się zauważyć.
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
- **Zapis konfiguracji stosował się dopiero po restarcie** (zgłoszone i naprawione
  2026-10-01, 0.1.33). Przy wydzielaniu `QsoPipeline` dla Logger32 (0.1.32) lista
  celów, główny PIN i operacje przeniosły się do potoku, a `applyConfig` nadal
  przypisywał je do nasłuchu UDP — czyli do własności, których już tam nie było.
  Skutek był gorszy niż brak działania: plik na dysku się zmieniał, okno mówiło
  „Zapisano i zastosowano", `restartRequired` było puste, a QSO leciały wedle
  ustawień sprzed zapisu. Wyszło przy teście Logger32 przez sieć: po wyłączeniu
  wszystkich celów kopia dalej poszła pod SN8N, zamiast pod własny znak, i serwis
  ją odrzucił. Testy tego nie łapały, bo atrapa daemona miała `listener: {}` —
  zwykły obiekt przyjmuje KAŻDE przypisanie. Nowe testy używają prawdziwego
  nasłuchu i potoku i sprawdzają skutek: gdzie naprawdę trafia QSO po zapisie.
- **Nasłuch UDP można wyłączyć** (`udp.enabled`, 0.1.33, prośba z 2026-10-01:
  „jeśli ktoś ma Logger32, to może nie potrzebować UDP"). Przełącznik działa tak
  samo jak ten przy TCP: wymaga restartu, bo gniazdo powstaje przy starcie. Brak
  klucza znaczy „włączony", więc starsze konfiguracje nie zmieniają zachowania.
  Obiekt nasłuchu powstaje nawet przy wyłączonym porcie, bo trzyma liczniki
  wspólne dla obu transportów — inaczej panele Źródła i Statystyki zgasłyby też
  dla QSO z Logger32. Oba nasłuchy wyłączone naraz są dozwolone, ale program
  mówi o tym wprost w logu i w zakładce Stan.
- **Nota „Nasłuch tylko na localhost" mówiła nieprawdę** (zgłoszone 2026-10-01).
  Zdanie dotyczyło całego programu, a opisywało wyłącznie adres UDP — przy UDP na
  `127.0.0.1` i TCP na `0.0.0.0` okno twierdziło, że nic nie wychodzi poza ten
  komputer, choć Logger32 logował przez sieć. Każdy kanał ma teraz własną notę,
  zależną od własnego adresu.
- **Zasiew portów obejmuje też TCP; wyłączony UDP nie jest mierzony** (0.1.33,
  pytanie z 2026-10-01: „jak to się ma do TCP i do wyłączonego UDP?"). Przed tą
  zmianą słowo „tcp" nie padało w `src/instalacja.js` ani razu: port 52005
  zostawał stały, więc druga instancja z włączonym Logger32 trafiała na
  `EADDRINUSE` — a ponieważ wyjątek ze startu nasłuchu przerywa start CAŁEGO
  rdzenia, nie działało wtedy także UDP i okno pokazywało „Mostek nie
  wystartował". Teraz instancja portable dostaje własny port TCP (52015, 52025…)
  nawet przy wyłączonym nasłuchu, bo włączenie go jest jednym kliknięciem.
  Przy `udp.enabled: false` zasiew pomija sondowanie portu UDP. Świadomie NIE
  łagodzimy awarii nasłuchu TCP do ostrzeżenia: dla kogoś z Logger32 to jedyne
  źródło QSO, a program, który „działa" i po cichu nie przyjmuje łączności,
  byłby gorszy od takiego, który wprost mówi, że nie wstał.
- **Paczka dla Arch Linuksa** (0.1.34). Społeczność wydała `radiodyplom-bridge-bin`
  (pakuje nasz AppImage) kilka godzin po wpisie na Facebooku — suma kontrolna
  w jej PKGBUILD zgadza się co do znaku z naszym wydaniem. Obok niej mamy własną,
  budowaną ze źródeł, na SYSTEMOWYM Electronie: 489 kB zamiast 120 MB, poprawki
  Chromium z pacmanem, bez `--no-sandbox`, z trybem bez okna i jednostką systemd.
  Budowa w kontenerze Arch wyłapała trzy błędy niewidoczne u nas: twardy import
  `js-yaml` w teście wywalał `check()` i całą budowę pakietu; konfiguracja usługi
  w `/etc` była nieczytelna dla konta, na którym usługa chodzi; a uruchamianie
  Electrona plikiem zamiast katalogiem dawało oknu `WM_CLASS` równe `electron`,
  przez co wpis w menu nie skojarzyłby się z oknem. Wniosek ogólniejszy:
  **pakowanie w obcej dystrybucji jest testem, którego nie zastąpi czytanie
  własnego kodu.**
- **macOS i RUMlogNG — wkład z zewnątrz** (0.1.35). Pierwszy pull request spoza
  projektu: Kamil Pawlak SO8KP przysłał komplet portu na macOS (pakowanie `.dmg`
  i `.zip` dla arm64 i x64, obsługa zdarzenia `activate` w Docku, dokumentacja,
  testy) oraz opis RUMlogNG, który gada po UDP protokołem N1MM. Sprawdził to na
  MacBooku Pro M2 Pro, a wersję dla Intela na starym MacBooku.
  Recenzja wychwyciła cztery rzeczy, w tym dwie poważniejsze: zaszyte w kodzie
  nazwisko (zamiast odczytu z `package.json`) i testy wywracające budowę paczki
  AUR bez `node_modules`. Wszystkie poprawione przez autora.
  Pytania, których nie dało się rozstrzygnąć bez Maca, rozstrzygnął próbny
  workflow na `macos-latest`: budowanie krzyżowe DZIAŁA (`lipo` potwierdza
  arm64 i x86_64), testy przechodzą, a systemowy `openssl` to LibreSSL 3.3.6 —
  który wypisuje SAN-y tak samo jak OpenSSL, więc usunięta asercja o adresie IP
  mogła wrócić; pada wyłącznie `openssl verify` (`error 20`).
  Datagram RUMlogNG przechwycony z żywego programu jest w testach — wniosek
  z Logger32: dopóki nie ma przechwyconego datagramu, „obsługujemy" jest
  przypuszczeniem.
- **Niestabilne testy: stałe numery portów** (naprawione 2026-10-04). Raz na
  kilkanaście przebiegów padał pojedynczy test — zawsze inny, zawsze przechodzący
  przy powtórzeniu. Diagnoza wyszła dopiero przy obciążeniu: dwa zestawy testów
  uruchomione naraz dawały **około 30 porażek na przebieg**, wszystkie z jednego
  powodu — testy API i testy portów używały numerów wpisanych na sztywno
  (12777, 12779, 52105, 12160), więc padały, gdy ktokolwiek inny trzymał ten port:
  działający mostek na maszynie, drugi przebieg, cokolwiek. Taka porażka nie niesie
  żadnej informacji, a kosztuje czas na szukanie nieistniejącego błędu — i to
  u kogoś, kto właśnie przysłał pierwszy pull request.
  Porty bierzemy teraz od systemu (`test/pomoc-porty.js`). Po zmianie: osiem
  przebiegów pod tym samym obciążeniem, **zero porażek**.
  Przy okazji wyszedł prawdziwy błąd w kodzie: `wolnaParaPortow` i
  `wolnyPortLogger32` miały sufit wpisany na stałe (12200, 52205), więc przy
  porcie ustawionym wyżej `od` wychodziło ponad `doKtorego`, pętla nie robiła ani
  jednego obrotu i zajęty port **nie był przestawiany — bez słowa w logu**. Sufit
  liczy się teraz od `od`. Mutacja potwierdzona.
- **Rdzeń nie startował na Windowsie, dopóki nie uruchomiono go raz jako
  administrator** (zgłoszone 2026-10-04 przez SQ9MEZ na **0.1.35**, czyli na
  bieżącym kodzie; **przyczyny nie ustaliliśmy**).
  Objaw: po odhaczeniu nasłuchu UDP program pokazywał „Mostek nie wystartował".
  U nas nie do odtworzenia — rdzeń i okno wstają z wyłączonym UDP zarówno
  w trybie headless, jak i w Electronie (sprawdzone na izolowanej konfiguracji).
  Instalacja i pierwsze uruchomienie z prawami administratora usunęły problem
  i więcej nie wrócił; zgłaszający podejrzewa zaporę albo inne oprogramowanie
  ochronne. Zapisane w `docs/windows-i-siec.md` jako obejście, które komuś
  pomogło — wyraźnie NIE jako wyjaśnienie.
  Co z tego wynikło na pewno: powód awarii startu lądował na banerze w surowej
  postaci systemowej, więc zgłaszający zapamiętał z niego tyle, co z plakietki.
  Komunikaty o nieudanym otwarciu portu mówią teraz, co zrobić (`src/bledy-portow.js`).
  Lekcja ogólniejsza: **„u nas nie do odtworzenia" nie znaczy „nie ma problemu"** —
  znaczy tylko, że nie mamy jeszcze dowodu. Dlatego prosimy o plik zgłoszenia,
  a nie o opis z pamięci.
- **HamAward i HamConnect — ten sam pomysł, niezależnie** (rozpoznane 2026-10-04).
  HamAward to włoski serwis dyplomowy, który do odbioru QSO używa własnego
  programu-pośrednika **HamConnect**: przechwytuje datagramy UDP z loggera
  i wysyła je do serwisu. Czyli dokładnie nasza architektura — i dokładnie to,
  co opiekun QLoga napisał, odrzucając pomysł wysyłania po HTTP wprost z loggera
  („the ideal solution would be to implement a dedicated UDP bridge").
  Dwa serwisy doszły do tego niezależnie; warto o tym pamiętać, gdy ktoś znów
  zaproponuje wkładanie logiki serwisu do programu logującego.

  **Z ich dokumentacji** (hamaward.cloud, wersja 25.12.0): paczki na Windows,
  macOS, Linux deb i AppImage; pobranie **wymaga konta** w serwisie; lista
  obsługiwanych loggerów obejmuje m.in. QARTest, Log4OM, WSJT-X, DXLog, N1MM,
  Swisslog, MSHV, JTDX, LogHX, Win-Test, **BBlogger** (podają dla niego port
  **12060**, czyli nasz domyślny), HRD, WriteLog i QLog; adres odbioru domyślnie
  `0.0.0.0`, multicast opcjonalnie. Ostrzegają czerwonym drukiem przed
  antywirusem kasującym pobrany plik — czyli kłopoty z oprogramowaniem ochronnym
  na Windowsie to cecha gatunku, nie nasza specyfika (patrz zgłoszenie SQ9MEZ
  z tego samego dnia).

  **Z użytkowania przez nas** (SQ8BWM, SQ8BWA — nie z ich dokumentacji): bufor
  z ponawianiem istnieje, ale wielkości nie znamy i najpewniej **nie przeżywa
  restartu programu**; w praktyce po komunikacie o braku łączności trzeba było
  **przerwać pracę i poczekać**, aż wróci. U nas kolejka leży na dysku i przeżywa
  restart, więc można nadawać dalej.

  **Czego nie wiemy i nie zgadujemy:** czy mają rozmnażanie jednego QSO na kilka
  znaków stacji, czy obsługują Logger32 po TCP i jak dokładnie działa ich
  ponawianie. Brak w opisie nie znaczy brak w programie.

  Lekcja metodologiczna: najpierw napisałam w porównaniu „tylko Windows", bo tak
  wynikało z JEDNEGO zdania w cudzym przewodniku („download the Windows
  Hamconnect"). Pobieranie jest za logowaniem, więc nie miałam jak tego
  sprawdzić — i w takiej sytuacji należało napisać „nie wiem", a nie domykać
  wniosku. Prostował to użytkownik, który ten program po prostu miał
  uruchomiony na Linuksie.
