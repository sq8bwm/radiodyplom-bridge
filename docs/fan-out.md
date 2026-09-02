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
    { "station_callsign": "SN0ABC", "operator": "SQ8BWM" },
    { "station_callsign": "SP0DEF", "operator": "SP4OIK" }
  ]
}
```

Cel opisują dwa pola:

- `station_callsign` — **wymagany**. Znak stacji; **nadpisuje** znak z loggera.
  To jedyne pole, które serwer sprawdza — musi być na liście stacji Twojego konta.
- `operator` — opcjonalny. Trafia do pola `OPERATOR` w QSO; serwer go **nie
  weryfikuje** (sprawdzone: przechodzi nawet znak nieistniejący). Bez niego
  zostaje operator z loggera.

Znak stacji i operator to **dwa różne pola** i celowo nie podstawiamy jednego pod
drugie: przy pracy pod znakiem okolicznościowym stacja to `SP0DEF`, a operator
to konkretna osoba.

- **Pusta lista (domyślnie)** → jedno QSO ze znakiem stacji z loggera. Zero zmian.
- `pin` — PIN wpisany wprost w cel, żeby wysłać kopię z **innego konta**. Droga
  z 0.1.x, nadal działa, nie ma jej w interfejsie. Przy jednym koncie z listą
  stacji nie jest potrzebna.

**Jeden PIN wystarcza na wszystkie stacje**, które masz na liście stacji swojego
konta w Managerze (patrz [Model uprawnień](konfiguracja.md)). Znak spoza tej
listy wraca jako `NOT_SAVED` — daemon mówi o tym też na starcie.

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
> **Fan-out na inny znak stacji NIE wymaga drugiego PIN-u** — wymaga, żeby ten
> znak był na liście stacji Twojego konta. Wcześniejsza wersja tej dokumentacji
> twierdziła inaczej; sprostowanie i pomiar w „Model uprawnień".

**Uwaga na przepustowość:** trzy cele to trzy żądania na jedno QSO, a limit wynosi
10/min. Przy trzech celach realna przepustowość to ok. 3 QSO/min; nadmiar czeka
w kolejce i jest dosyłany.
