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

Cel opisują cztery pola:

- `station_callsign` — **wymagany**. Znak stacji; **nadpisuje** znak z loggera.
  To jedyne pole, które serwer sprawdza — i sprawdza je wobec **trwającej
  akcji**, nie tylko wobec konta: znak musi być dodany do akcji jako
  **aktywator**. Uprawnienie konta „mogę logować jako wszystkie stacje" tego
  NIE zastępuje (zmierzone 2026-09-08 na znaku SN8N: konto miało szerokie
  uprawnienie, a kopia i tak nie miała gdzie się zapisać).
- `operator` — opcjonalny. Trafia do pola `OPERATOR` w QSO; serwer go **nie
  weryfikuje** (sprawdzone: przechodzi nawet znak nieistniejący). Bez niego
  zostaje operator z loggera.
- `pin` — opcjonalny. PIN **konta**, z którego ma polecieć ta kopia. Potrzebny
  tylko wtedy, gdy dana stacja **nie jest przypisana do Twojego** konta, a jest
  do cudzego. Brak = PIN główny.
- `enabled` — opcjonalny, domyślnie `true`. `false` **wyłącza regułę bez
  usuwania jej danych**: znak, operator i PIN zostają w pliku, a kopia nie
  powstaje. Do tego służy pole wyboru „Aktywna" w oknie.

### Wyłączanie reguł

Wyłączenie wszystkich reguł zachowuje się **jak brak reguł**: leci jedno QSO ze
znakiem stacji z loggera. Świadomie nie „nie wysyłamy nic" — ciche gubienie QSO
to najgorsze, co ten program może zrobić.

Wyłączona reguła nie blokuje też swojego znaku: jeśli masz dwie reguły na tę
samą stację i jedna jest wyłączona, druga zadziała (odrzucanie duplikatów
liczy tylko reguły czynne).

### PIN celu w oknie

Pole pokazuje PIN **zamaskowany** (`ABCD-****`), a przy zapisie ma cztery stany:

| Co przyszło | Co się dzieje |
|---|---|
| pole nieprzysłane (starszy klient, skrypt) | zostaje dotychczasowy |
| zamaskowane | zostaje dotychczasowy |
| nowa wartość | zapisana |
| **puste, a PIN był** | **usunięty** — kopia poleci PIN-em głównym |

Ostatni stan to jedyna droga cofnięcia własnego PIN-u z okna, więc jest za
potwierdzeniem: okno wymienia stacje, których to dotyczy, i ostrzega, że
sekretu nie da się odczytać z powrotem.

Rozróżnienie „nie przysłano" od „przysłano puste" jest istotne — bez niego
klient, który o tym polu nie wie, po cichu kasowałby cudze PIN-y.

Znak stacji i operator to **dwa różne pola** i celowo nie podstawiamy jednego pod
drugie: przy pracy pod znakiem okolicznościowym stacja to `SP0DEF`, a operator
to konkretna osoba.

- **Pusta lista (domyślnie)** → jedno QSO ze znakiem stacji z loggera. Zero zmian.
- `pin` — PIN wpisany wprost w cel, żeby wysłać kopię z **innego konta**. Droga
  z 0.1.x, nadal działa, nie ma jej w interfejsie. Przy jednym koncie z listą
  stacji nie jest potrzebna.

**Jeden PIN wystarcza na wszystkie stacje**, na które wolno Ci logować w danej
akcji (patrz [Model uprawnień](konfiguracja.md)). Znak, którego akcja nie
dopuszcza, wraca jako `NOT_SAVED` — daemon mówi o tym też na starcie.

**Dwa warunki, nie jeden.** Żeby kopia się zapisała, musi się zgadzać jedno
i drugie: konto (PIN) ma prawo logować na ten znak **oraz** znak jest
w trwającej akcji aktywatorem. Drugi warunek jest ustawiany w samej akcji na
radiodyplom.pl i to on częściej bywa przyczyną odrzuceń, bo o nim się zapomina.

Lista stacji, którą oddaje API — i którą pokazujemy w panelu *Konto* — jest
listą z **kontekstu akcji**: poza akcją jest pusta, a w trakcie zawiera znaki
dopuszczone w tej akcji. Dlatego mostek nie ostrzega o pustej liście poza
akcją (od 0.1.28) i dlatego ostrzeżenie w trakcie akcji mówi o aktywatorze,
a nie o „liście stacji konta" (od 0.1.29).

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
> **Fan-out na inny znak stacji NIE wymaga drugiego PIN-u** — wymaga, żeby na
> ten znak wolno Ci było logować w akcji, czyli żeby był w niej aktywatorem.
> Wcześniejsze wersje tej dokumentacji mówiły najpierw o drugim PIN-ie, potem
> o „liście stacji konta"; oba opisy były niepełne, sprostowanie i pomiar
> w „Model uprawnień".

**Uwaga na przepustowość:** trzy cele to trzy żądania na jedno QSO, a limit wynosi
10/min. Przy trzech celach realna przepustowość to ok. 3 QSO/min; nadmiar czeka
w kolejce i jest dosyłany.
