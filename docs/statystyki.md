# Statystyki

Zakładka **Statystyki** w oknie programu odpowiada na pytania „ile QSO w sobotę",
„ile na której akcji", „kto pracował spod której stacji".

## QSO to nie kopia

Wszędzie podawane są **dwie liczby**, bo to dwa różne pytania:

| Liczba | Znaczy |
|---|---|
| **QSO** | ile łączności przeprowadził operator |
| **kopie** | ile razy mostek wysłał je na serwis |

Jedno QSO rozmnożone na trzy znaki stacji to **trzy kopie, ale jedno QSO**.
Mieszanie tych liczb było dokładnie tym, co naprawialiśmy na kartach zakładki
Stan — tutaj od początku stoją obok siebie.

Średnia „QSO na dzień" liczona jest przez **dni z łącznościami**, nie przez
długość zakresu. Tydzień z jedną sobotą w eterze inaczej wyglądałby na
katastrofę.

Podsumowanie podaje też **liczbę różnych znaków korespondentów** — lista
„najczęściej pracowane" pokazuje tylko czoło, a „… i N więcej" liczone jest
z pełnego przekroju (`distinct` w odpowiedzi API), nie z długości przyciętej
listy. Napisane raz odwrotnie, pokazywało „i 10 więcej" przy 237 pracowanych
znakach — liczba wyglądała wiarygodnie i była nieprawdziwa.

## Zawężanie po operatorze i stacji

Dwie listy nad podsumowaniem zawężają **całą zakładkę**, razem z podsumowaniem
i wszystkimi przekrojami. Do wyboru są tylko wartości, które w wybranym zakresie
dat naprawdę występują — i pochodzą z danych **niezawężonych**, więc po wybraniu
operatora pozostali nie znikają z listy i da się wrócić.

Uwaga na znaczenie filtra po stacji: kopie jednego QSO mają **różne** znaki
stacji. Zawężenie do `SN8N` pokazuje te łączności, które poszły pod tym
znakiem — a nie „wszystkie QSO z sesji, w której leciało też SN8N". Dlatego przy
takim zawężeniu liczba QSO i liczba kopii są zwykle równe: na każde QSO
przypada wtedy jedna kopia.

Wartości nieobecne w danych są **odrzucane**, a nie ignorowane w sposób, który
pokazywałby pełne statystyki: gdyby „nie pasuje" znaczyło „pokaż wszystko",
użytkownik patrzyłby na całość w przekonaniu, że widzi jedną stację. Zamiast
tego pojawia się komunikat, że nic nie pasuje do zawężenia — inny niż ten
o pustym dzienniku.

## Skąd się to bierze

Plik na miesiąc, jedna linia na wysłaną kopię, w formacie JSON Lines:

```
<dataDir>/data/sent/sent-2026-09.jsonl
```

```json
{"at":"2026-09-03T20:30:02.246Z","date":"2026-09-03","time":"20:30",
 "call":"SP8PKX","station":"SQ8BWM","operator":"SQ8BWM","actions":["295"],
 "band":"80m","mode":"SSB","source":"QLog"}
```

Dopisywanie jednej linii jest odporne na ubicie procesu — pliku nie
przepisujemy. Ucięta ostatnia linia jest pomijana przy czytaniu, więc awaria
w trakcie zapisu nie odbiera dostępu do całej reszty.

**Czego w dzienniku nie ma i dlaczego:**

- **przejść próbnych** — QSO, które nie opuściło komputera, nie jest wysłane;
- **duplikatów odbitych przez serwis** — te QSO serwis miał już wcześniej,
  drugi wpis zawyżałby liczby;
- **odrzuceń** — nic się nie zapisało, nie ma czego liczyć;
- **PIN-ów.** Nigdy.

Statystyki liczone są **przy odpytaniu**, nie jako liczniki na bieżąco. Liczniki
trzeba by migrować przy każdej nowej przekrojówce; dziennik pozwala dodać nowy
przekrój bez ruszania danych. Zakładka odświeża się przy wejściu, a nie w pętli —
to przejście po całym dzienniku.

Zakres podaje się **datami QSO** (`RRRR-MM-DD`), nie czasem wysłania: dla
aktywatora liczy się dzień łączności, a nie moment, w którym mostek ją dosłał.
Data QSO idzie z pola ADIF, czyli jest w UTC.

## Odtworzenie historii z logów

Dziennik powstał w wersji 0.1.10. Wcześniejsze QSO da się odzyskać z plików logu —
jest w nich wszystko poza datą samej łączności:

Z katalogu z kodem:

```bash
node src/tools/import-log.js --dry  ~/.local/share/radiodyplom-bridge/data/bridge.log
node src/tools/import-log.js        ~/.local/share/radiodyplom-bridge/data/bridge.log
```

Z **zainstalowanej** wersji (bez Node w systemie — używamy tego, który jest
w paczce; sprawdzone na zbudowanym pakiecie):

```bash
APP=/opt/RadioDyplom\ Bridge
ELECTRON_RUN_AS_NODE=1 "$APP/radiodyplom-bridge" \
  "$APP/resources/app.asar/src/tools/import-log.js" \
  --dry ~/.local/share/radiodyplom-bridge/data/bridge.log
```

Najpierw zawsze `--dry` — pokaże, ile wpisów by dodał i z jakiego zakresu dat,
nie zapisując niczego.

| Przełącznik | Działanie |
|---|---|
| `--dry` | tylko pokazuje, co by zapisał |
| `--dir KATALOG` | inny katalog dziennika |
| `--skip-call ZNAK` | pomija wskazany znak (można wielokrotnie) |

Narzędzie paruje wpisy „Nowe QSO" (mają znak stacji, pasmo, emisję i operatora)
z potwierdzeniami „zapisane" (mają numery akcji), w kolejności, per znak.
Przejścia próbne odsiewa — do wersji 0.1.6 meldowały się jako „zapisane".

**Powtórne uruchomienie nie dubluje wpisów**: klucz porównania to
`data|godzina|znak|stacja`, więc odporny na to, że czas wysłania czytany jest
raz z logu, a raz z zegara działającego programu.

Dwa ograniczenia, o których warto wiedzieć:

- **Czas łączności bierze się z logu**, bo log nie niesie `qso_date` ani
  `time_on`. Jest w UTC, tak jak ADIF, a mostek wysyła QSO w kilka sekund po
  zalogowaniu — dzień wychodzi ten sam. Wpisy odtworzone mają `imported: true`.
- **Ten sam znak pracowany dwa razy w tej samej minucie** policzy się jako jedno
  QSO, bo klucz QSO to `data|godzina|znak` z dokładnością do minuty.

QSO testowe wyrzuca się jawnie, przez `--skip-call` — narzędzie samo nie odsiewa
niczego po kształcie znaku, bo „SN0TEST" bywa prawdziwym znakiem okolicznościowym.

## API

```
GET /api/stats?from=2026-09-01&to=2026-09-30&operator=SQ8BWA&station=SN8N
```

Zakres i oba filtry są opcjonalne. Przyjmowane są tylko **istniejące** daty
(`2026-13-99` jest odrzucane, a nie po cichu porównywane jako tekst) oraz takie
wartości filtrów, które w danych występują. Odpowiedź zawiera `filters`
z faktycznie zastosowanym zawężeniem i `options` z listami do wyboru — okno
bierze swój stan z odpowiedzi, nie z tego, co kliknięto. Odpowiedź zawiera
`total` oraz przekroje `perDay`, `perAction`, `perOperator`, `perStation`,
`perBand`, `perMode`, `perSource` i `topCalls` — każdy jako lista
`{key, qso, copies}` — oraz `distinct` z liczbą RÓŻNYCH wartości w każdym
przekroju. `topCalls` jest przycięte do 50 pozycji, więc do „ile jeszcze"
trzeba brać `distinct.calls`, a nie długość listy. Do `perAction` dokładana jest nazwa akcji z `PING`-a,
o ile serwis ją podaje (podaje tylko dla akcji **aktywnych**).
