# Gdy coś nie działa

Objawy zgłaszane przez użytkowników i to, co o nich wiemy. Rzeczy ściśle
windowsowe — program się nie uruchamia, rdzeń nie startuje, datagramy nie
dochodzą, zapora — są osobno w [Windows i sieć](windows-i-siec.md).

Zanim coś zgłosisz: w oknie, zakładka *O programie*, jest przycisk **Zapisz
zgłoszenie do wysłania**. Ten plik ma PIN-y zamaskowane. Nie wysyłaj
`config.json` — jest w nim jawny PIN.

---

## Okno jest całkiem białe

Okno otwiera się, ma tytuł i ramkę, a w środku jest biały prostokąt. Ikona
w zasobniku jest na swoim miejscu.

**Mostek pracuje dalej.** Białe okno to zepsuty *widok*, nie zepsuty program:
rdzeń nadal nasłuchuje datagramów z loggera i nadal wysyła QSO na serwer.
Nie ma więc powodu do pośpiechu w trakcie zawodów — łączności nie giną.
Sprawdzić to można bez okna:

- plik logu rośnie — *Otwórz log* z menu zasobnika;
- to samo okno w przeglądarce: `http://localhost:12061/`. Jeśli rysuje się
  tam normalnie, popsute jest okno programu, a nie mostek. **Tego nie
  sprawdziliśmy przy prawdziwej awarii** — więc jest to rzecz do sprawdzenia,
  a nie obiecane obejście.

### Co pomaga

**Uruchom ponownie komputer** — i to dosłownie: w menu Start wybierz
*Uruchom ponownie*, nie *Zamknij*.

Na Windowsie to nie jest czepianie się słówek. Przy włączonym **szybkim
rozruchu** (domyślnie jest włączony) „Zamknij", a potem włączenie przyciskiem
to *rozruch hybrydowy*: system zapisuje stan jądra i sesji na dysk, a przy
starcie go odtwarza. Komputer wygląda na uruchomiony od zera, a sesja graficzna
ciągnie się dalej — ta sama, która jest popsuta. Tylko *Uruchom ponownie*
zaczyna sesję od nowa. Poznać to po czasie pracy systemu: jeśli po „wyłączeniu
na noc" Menedżer zadań pokazuje kilka dni, to szybki rozruch działa.

### Co o tym wiemy

Widzieliśmy to raz, na maszynie z Windowsem, przy sześciu dniach
nieprzerwanej pracy systemu (wersja mostka 0.1.41). Rozstrzygające było to,
że **starsza wersja 0.1.37, która wcześniej działała na tej samej maszynie,
też pokazywała białe okno** —
czyli przyczyna nie leżała w wydaniu. Sprawdzone i wykluczone: plik `app.asar`
co do bajtu taki sam jak na działającej maszynie, konfiguracja z tego komputera
rysuje się poprawnie gdzie indziej, `--disable-gpu` nic nie zmienia. Po
ponownym uruchomieniu systemu okno rysuje się normalnie.

Mechanizmu nie znamy — wiemy tylko, że restart pomógł. Jeśli trafisz na to
u siebie, przyda się jedna odpowiedź: **czy inne programy oparte na Electronie
też miały wtedy białe okna** (Signal, Discord, VS Code, Slack). To odróżnia
usterkę systemu od naszej.

Nowsze wydania zapisują do logu, gdy widok się nie wczyta, padnie
albo przestanie odpowiadać. Jeśli w logu nie ma nic, a okno jest białe —
to też jest informacja: znaczy, że widok wstał i tylko go nie widać.
