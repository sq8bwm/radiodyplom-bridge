# Rozmnażanie QSO na wiele stacji

Jak wysłać jedną łączność jako kilka odrębnych wpisów.

[← powrót do README](../README.md)


## Fan-out: jedno QSO → kilka wpisów

To samo QSO z loggera można wysłać jako **kilka odrębnych łączności**, każdą z innym
znakiem stacji. Konfiguruje się to listą celów:

```json
"forward": {
  "operations": ["insert"],
  "targets": [
    { "station_callsign": "SN0ABC" },
    { "station_callsign": "SP0DEF", "operator": "SQ8BWM" },
    { "station_callsign": "3Z0GHI", "operator": "SP0OPER", "pin": "INNY-PIN" }
  ]
}
```

- **Pusta lista (domyślnie)** → jedno QSO ze znakiem stacji z loggera. Zero zmian.
- `station_callsign` — wymagany, **nadpisuje** znak podany przez logger.
- `operator` — opcjonalny. Bez niego zostaje operator z loggera. Celowo **nie**
  podstawiamy tu znaku stacji: to dwa różne pola.
- `pin` — **wymagany, gdy `station_callsign` należy do innego profilu niż PIN główny**
  (patrz „Model uprawnień"). Bez niego kopia wróci jako `NOT_SAVED`.

Pozostałe pola (data, czas, znak korespondenta, pasmo, emisja, raporty, `freq`,
komentarz) są w każdej kopii identyczne.

**Warunek konieczny:** każdy znak stacji musi mieć uprawnienia w aktywnej akcji.
To `station_callsign` decyduje, do której akcji trafi QSO (serwer zwraca listę
`savedTo`) — PIN jedynie autoryzuje. Znak bez uprawnień daje odpowiedź
`success:true` z **pustym** `savedTo`, czyli QSO nie zostaje zapisane; daemon
wykrywa to jako błąd `NOT_SAVED` i odkłada kopię do `data/failed/`.

Każda kopia jest osobnym elementem kolejki, więc ma własne ponowienia i własny
status — awaria jednej nie blokuje pozostałych.

> **Punktacja kopii.** Reguła duplikatu w akcji obejmuje znak stacji, więc kopie
> wysłane na różne stacje punktują się niezależnie — o to w fan-oucie chodzi.
> (Nie przeszło jeszcze testu end-to-end na dwóch stacjach, bo wymaga dwóch
> znaków uprawnionych w akcji.)
>
> **Fan-out na inny znak stacji wymaga własnego PIN-u** — patrz „Model uprawnień".
> Daemon ostrzega o tym na starcie, porównując znak celu z profilem PIN-u.

**Uwaga na przepustowość:** trzy cele to trzy żądania na jedno QSO, a limit wynosi
10/min. Przy trzech celach realna przepustowość to ok. 3 QSO/min; nadmiar czeka
w kolejce i jest dosyłany.
