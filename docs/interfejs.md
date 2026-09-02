# Interfejs graficzny i API stanu

Okno aplikacji, praca w zasobniku, język oraz lokalne API dla podglądu stanu.

[← powrót do README](../README.md)


## Interfejs graficzny (Electron)

```bash
npm install      # electron jako zależność deweloperska
npm run ui
```

Aplikacja żyje **w zasobniku systemowym**. Zamknięcie okna ją tylko ukrywa —
mostek pracuje dalej.

**Aby zakończyć program, użyj przycisku „Zakończ" w oknie.** Menu pod ikoną
w zasobniku robi to samo, ale nie na każdym systemie jest dostępne (na Windows
potrafi się nie pokazywać), więc przycisk w oknie jest drogą pewną.

Ikona pokazuje stan bez otwierania okna:

| Kolor | Znaczenie |
|---|---|
| zielona | działa, łączność jest |
| **czerwona** | **brak łączności z radiodyplom** — QSO czekają w kolejce i będą dosłane automatycznie |
| żółta | wysyłka wstrzymana ręcznie, albo są QSO odrzucone (wymagają Twojej decyzji) |

Brak łączności rozpoznawany jest **dwiema drogami**, żeby nie umknął w żadnym scenariuszu:
- **cykliczny PING** (domyślnie co 60 s, `radiodyplom.pingIntervalMs`) — wykrywa problem
  także wtedy, gdy kolejka jest pusta i nic nie próbuje się wysłać;
- **realna próba wysyłki** — flaga `queue.online` gaśnie, gdy POST nie przeszedł
  z powodu sieci. To sygnał najwierniejszy, bo wynika z faktycznego żądania.

Błąd trwały (zły znak, brak uprawnień) **nie** gasi łączności — to problem z danymi,
nie z siecią, i dlatego daje stan żółty, a nie czerwony.

### Język
Przełącznik **Polski / English** w nagłówku okna. Wybór zapamiętywany w konfiguracji
(`language`), więc obowiązuje też dla menu i podpowiedzi w zasobniku oraz po restarcie.
Tłumaczenia siedzą w jednym słowniku `ui/strings.js` — bez żadnej biblioteki.

Komunikaty błędów z API przychodzą **po polsku z serwera**, dlatego przy angielskim
interfejsie tłumaczymy je **po kodzie** (`INVALID_CALLSIGN`, `NOT_SAVED`,
`INVALID_API_KEY`…), a treść serwera zostaje w nawiasie jako uzupełnienie.

Pięć zakładek:
- **Stan** — liczniki, adres nasłuchu, rozbicie na źródła (QLog / N1MM / WSJT-X),
  ostatnie wysłane QSO i ostatni błąd.
- **Kolejka** — co czeka i co zostało odrzucone: znak, stacja, **operator**, liczba prób,
  powód. Operator jest tu istotny przy rozmnażaniu QSO: dwie kopie tej samej łączności
  różnią się stacją *i* operatorem, więc bez tej kolumny nie odróżnisz ich od siebie.
- **Konfiguracja** — PIN, tryb próbny, adres i port nasłuchu, grupy multicast,
  cele rozmnażania QSO.
- **Log** — bieżące zdarzenia.
- **O programie** — wersja, autor, licencja i zdanie o braku gwarancji, plus
  odnośniki do pełnego tekstu licencji, repozytorium i wydań.

Zakładka „O programie" **nie ma niczego wpisanego na sztywno** — wersję, autora,
licencję i adres repozytorium bierze z `/api/status`, czyli z `package.json`.
Bez tego numer wersji w oknie rozjechałby się z nazwą pliku instalatora przy
pierwszym ręcznym podniesieniu wersji. Adres e-mail autora jest świadomie
pomijany: w oknie nie jest potrzebny, a w metadanych `.deb` i tak jest.

Odnośniki otwierają się w **przeglądarce systemowej**, przez IPC `openUrl`,
nie w oknie aplikacji. Uchwyt w procesie głównym przepuszcza wyłącznie adresy
`https://` — `shell.openExternal` wykonałby też `file:` czy `mailto:`.

**PIN-y są w UI zawsze zamaskowane** (`ABCD-****`), także PIN-y celów fan-outu.
Pole zostawione zamaskowane oznacza „nie zmieniaj"; nowy PIN wpisuje się w całości.
Renderer nie ma dostępu do Node ani do rdzenia — wszystko idzie przez wąski most
IPC w `preload.cjs`.

### Co działa od razu, a co po restarcie
Od razu: PIN, tryb próbny, adres API, cele fan-outu i ich PIN-y, limity tempa,
poziom logowania, język.

Po restarcie: `udp.host`, `udp.port`, `udp.multicastGroups`, `api.port`, `api.enabled`,
`dataDir` i ścieżki kolejki — gniazdo UDP i kolejka są otwarte od startu procesu.

Zapis zwraca `restartRequired` (co właśnie wymaga restartu) oraz `pendingRestart`
(wszystko, co go jeszcze czeka). Dopóki lista nie jest pusta, nad zakładkami wisi
**trwały żółty banner**, a podpowiedź ikony w zasobniku dopisuje „wymaga restartu".

Banner jest sterowany stanem, nie odpowiedzią na zapis — jednorazowy komunikat
ginął przy przełączeniu zakładki, a wtedy zakładka Konfiguracja pokazywała nową
wartość, a Stan starą, bez niczego, co by je łączyło.

### Architektura UI
Electron **osadza rdzeń we własnym procesie** (`startDaemon`) i rozmawia z nim
bezpośrednio, bez HTTP. Serwer stanu zostaje włączony tylko po to, by dało się
podejrzeć mostek z przeglądarki lub skryptu.

Rdzeń nie wie o istnieniu UI. `npm start` uruchamia go bez Electrona — na
Raspberry Pi w shacku czy jako usługa systemd — i to jest zachowanie docelowe,
a nie tryb awaryjny.


## API stanu (dla UI)

Daemon wystawia lokalną powierzchnię stanu, z której korzysta interfejs użytkownika
(Electron albo zwykła przeglądarka). Włączona domyślnie:

```json
"api": { "enabled": true, "port": 12061 }
```

| Metoda | Ścieżka | Działanie |
|---|---|---|
| GET | `/api/status` | pełny stan: nasłuch, statystyki źródeł, kolejka, liczniki, ostatnie QSO i błąd |
| GET | `/api/log?n=50` | ostatnie zdarzenia z logu (bufor 300 wpisów) |
| POST | `/api/pause` | wstrzymuje **wysyłkę**; odbiór z loggera i kolejkowanie działają dalej |
| POST | `/api/resume` | wznawia wysyłkę |
| POST | `/api/requeue` | przywraca QSO z `failed/` do kolejki |

Dwie decyzje projektowe, świadome i celowe:

> **Serwer nasłuchuje wyłącznie na `127.0.0.1`** — niezależnie od `udp.host`. To jest
> interfejs *sterujący* wysyłką QSO na Twoim PIN-ie; wystawienie go na sieć oddałoby
> obcym kontrolę nad Twoim logiem.

> **PIN-y nigdy nie opuszczają procesu.** W `/api/status` są zamaskowane (`ABCD-****`),
> tak samo PIN-y celów fan-outu. UI nie potrzebuje ich w jawnej postaci.

Jeśli **port API** (12061) jest zajęty, daemon loguje ostrzeżenie i pracuje dalej —
brak podglądu nigdy nie może zatrzymać przekazywania QSO. Sprawdzone: przy zajętym
12061 QSO z loggera nadal przechodzi.

To dotyczy **wyłącznie portu API**. Port UDP, na którym słucha logger, to osobna
sprawa — patrz „Zajęty port UDP" niżej.

`queue.pending` / `queue.failed` / `queue.sent` to **liczniki**, a `pendingItems`
i `failedItems` to listy przycięte do 50 pozycji — nie myl ich przy budowie UI.
