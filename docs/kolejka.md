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

Liczy **realnie wysłane** QSO. Trwałe odrzucenia trafiają do zbioru
deduplikacji, ale nie do tego licznika — wcześniej był nim rozmiar tego zbioru,
więc rósł przy każdym odrzuceniu i sugerował, że QSO doszło.
