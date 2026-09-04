# Kolejka, deduplikacja i log

Co się dzieje z QSO między odebraniem a zapisem na serwerze — i co, gdy coś pójdzie nie tak.

[← powrót do README](../README.md)


## Deduplikacja

Każde QSO ma klucz, po którym mostek rozpoznaje powtórki. Lista obsłużonych kluczy
(`data/seen.json`) przetrwa restart.

Klucz to **identyfikator z loggera + odcisk treści QSO**:

```
qlog:{logid}#{rowid}:{sha1(call|data|czas|pasmo|emisja|stacja)}
```

Odcisk jest tam **konieczny, nie ozdobny**. QLog podaje `rowid` z bazy SQLite, a taki
numer **jest ponownie używany po skasowaniu rekordu**. Klucz oparty na samym `rowid`
sprawiał, że nowe QSO z odzyskanym numerem znikało jako rzekomy duplikat — zdarzyło
się to realnie 2026-08-31 i kosztowało dwie łączności.

Sam odcisk treści też by nie wystarczył: ponowne zalogowanie tej samej łączności
w loggerze (naturalna reakcja operatora, gdy coś nie doszło) zostałoby wtedy
odrzucone, czyli droga ratunkowa przestałaby działać. Dlatego oba składniki naraz.

| Źródło | Identyfikator w kluczu |
|---|---|
| QLog | `{logid}#{rowid}` |
| N1MM | `<ID>` z XML |
| WSJT-X | brak (`noid`) — sam odcisk treści |

Do odcisku wchodzą tylko pola tożsamości łączności. Raporty, komentarz czy
częstotliwość **nie** — bywają poprawiane po fakcie, a to wciąż ta sama łączność.

Przy fan-oucie do klucza doklejany jest znak stacji celu (`…|SN0ABC`), inaczej trzy
kopie miałyby ten sam klucz i do kolejki weszłaby tylko pierwsza.

**Pominięcie jest widoczne w logu i liczone** (karta „Pominięte (duplikaty)").
Wcześniej leciało na poziomie `debug`, więc zgubione QSO wyglądało jak „nic nie
przyszło" — najgorszy możliwy tryb awarii.


## Zachowanie przy błędach
- **Brak sieci / 5xx / timeout** → ponawianie z backoffem (5 s, 10 s, 20 s, 40 s…
  do 15 min), do `queue.maxAttempts`. Przy domyślnych ustawieniach
  (`baseDelayMs: 5000`, `maxDelayMs: 900000`, `maxAttempts: 20`) daje to
  **około 3,4 godziny automatycznego ponawiania**. Po powrocie łączności QSO
  wysyłają się **same, bez żadnej ingerencji** — sprawdzone testem: awaria,
  trzy nieudane próby z narastającym odstępem, powrót serwera i automatyczny zapis.
  Dopiero po wyczerpaniu prób QSO idzie do `data/failed/` **bez** oznaczania jako
  obsłużone, więc `npm run requeue` (albo przycisk w UI) przywróci je do wysyłki.
  Chcesz przetrwać dłuższą awarię bez klikania — podnieś `maxAttempts`.
- **`DUPLICATE_QSO`** → traktowane jak sukces (wysyłka jest idempotentna).
- **Odpowiedź z kodem błędu** (np. `INVALID_CALLSIGN`, `INVALID_API_KEY`,
  `INVALID_QSO_DATA`) → błąd **trwały**: serwer odrzucił dane, więc wynik jest
  deterministyczny i ponawianie nic nie zmieni. QSO ląduje w `data/failed/`
  po jednej próbie. Klasyfikacja działa domyślnie „trwały", a nie po liście
  znanych kodów — dzięki temu nowy, nieznany kod błędu nie jest ponawiany godzinami.
  Wyjątek: kody i komunikaty wskazujące na limit tempa są traktowane jako przejściowe.
- **Nieznany format datagramu** → ostrzeżenie z podglądem pierwszych bajtów, proces żyje.


## Log

Zdarzenia trafiają do konsoli, do bufora w pamięci (podgląd w zakładce **Log**)
oraz **do pliku** — `bridge.log` w katalogu danych, obok kolejki. Przycisk
„Pokaż plik logu" otwiera go w menedżerze plików; ta sama pozycja jest w menu
ikony w zasobniku.

Rotacja: po przekroczeniu `logFile.maxBytes` (domyślnie 5 MB) plik przechodzi na
`bridge.log.1`, starsze przesuwają się dalej, a najstarsze ponad `logFile.keep`
(domyślnie 3) jest usuwane.

Zapis jest **synchroniczny** i to świadoma decyzja: przy strumieniu asynchronicznym
ostatnie linie — czyli te najciekawsze przy awarii — ginęły razem z buforem przy
wyjściu z procesu. Log ma kilka linii na QSO, więc koszt jest bez znaczenia.

Wyłączenie: `"logFile": { "enabled": false }`.

## Licznik „wysłane"

Liczy **realnie wysłane kopie**. Trzy rzeczy, które do niego NIE wchodzą:

| Co | Dlaczego |
|---|---|
| trwałe odrzucenia | trafiają do zbioru deduplikacji, ale QSO nie doszło. Wcześniej licznik był rozmiarem tego zbioru, więc rósł przy każdym odrzuceniu |
| **przejścia próbne** | QSO nie opuściło komputera. Mają własny licznik `dryRun` w `seen.json`, żeby informacja nie przepadła |
| duplikaty odbite przez serwis | serwer już to QSO miał; osobny licznik sesji |

Jednostką są **kopie**, nie QSO: jedno QSO rozmnożone na trzy stacje to trzy
kopie. Licznik jest **trwały** — leży w `seen.json` i przeżywa restart.

To ostatnie łatwo pomylić z licznikami procesu („odebrane z loggera", „źródła"),
które zerują się przy każdym starcie. Realny przypadek: karta pokazywała 1119
wysłanych przy 191 odebranych — pierwsza liczba była sumą od początku i w kopiach,
druga z tego procesu i w datagramach. Dlatego każda karta na zakładce Stan ma dziś
drugą linię mówiącą, czego i za jaki czas liczy.

## Trzy przyciski w panelu Odrzucone

Wszystkie akcje dotyczące odrzuconych QSO są w jednym miejscu — na zakładce
**Kolejka**, pod tabelą odrzuconych. Kliknięcie plakietki „PROBLEMY: n"
w nagłówku prowadzi właśnie tam.

### „Ponów odrzucone"

Wraca do kolejki **wszystkie** odrzucone, także te, które serwer odrzucił
wcześniej „na zawsze". Ma to sens po poprawieniu uprawnień w Managerze:
`NOT_SAVED` z powodu znaku stacji poza listą konta przestaje być prawdą, gdy
tylko dopiszesz tam ten znak.

Wymaga **uwolnienia klucza z deduplikacji**, bo trwałe odrzucenie go zamyka.
Uwolnienie jest zapisywane na dysk — bez tego restart przywróciłby blokadę
i QSO utknęłoby w kolejce, odrzucane jako duplikat.

> Wcześniejsza wersja pomijała odrzucone przez serwer. Brzmiało to rozsądnie,
> ale w praktyce znaczyło, że przycisk **nie robił nic i nic o tym nie mówił** —
> nie do odróżnienia od zepsutego. Teraz przy każdym kliknięciu widać, ile QSO
> wróciło do kolejki, albo że nie było czego przywracać.

**Uwaga na tryb próbny.** Przy włączonym trybie próbnym przywrócone QSO przejdą
„na sucho": nie zostaną wysłane, a mimo to znikną z kolejki i zostaną zamknięte
w deduplikacji — czyli ponowienie **wyrzuci je**, choć klika się je właśnie po to,
żeby je uratować. Program pyta o to wprost, zanim cokolwiek ruszy. Chcesz je
naprawdę wysłać — najpierw wyłącz tryb próbny.

### „Wyczyść sygnalizację problemów"

Gasi plakietkę. QSO zostają. Pokazuje się tylko wtedy, gdy są niepotwierdzone.

### „Usuń odrzucone QSO"

Gdy odrzucone łączności są po prostu **błędne** — testowe, z pomyłkowym znakiem,
z nieuprawnionej stacji — i nie ma czego ratować. Opróżnia `data/failed/`.

Zabezpieczenia, bo to jedyna w programie akcja, która trwale niszczy dane:

- pytanie o potwierdzenie z **liczbą** QSO i zdaniem „TEGO NIE DA SIĘ ODWRÓCIĆ",
  plus podpowiedzią, że do wysłania ich mimo wszystko służy „Ponów odrzucone";
- **każde usunięte QSO trafia do pliku logu** — znak, stacja, kod błędu i klucz.
  Ciche kasowanie łączności byłoby wbrew całej zasadzie tego programu: jeśli QSO
  ma zniknąć, musi po nim zostać ślad.

Po usunięciu poziom potwierdzenia sygnalizacji zjeżdża do zera, więc następne
odrzucone QSO znów zapali plakietkę.
