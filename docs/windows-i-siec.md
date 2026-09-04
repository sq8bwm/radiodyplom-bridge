# Windows i praca w sieci shacku

Skąd odbierać datagramy, multicast, zapora, autostart i zachowanie przy zajętym porcie.

[← powrót do README](../README.md)


Rdzeń nie ma zależności natywnych ani niczego systemowo zależnego — działa na
Windows na tym samym Node ≥ 18. Poniżej rzeczy, które trzeba ustawić świadomie.

### Skąd odbierać datagramy
| `udp.host` | Co odbiera | Kiedy |
|---|---|---|
| `127.0.0.1` (domyślnie) | tylko z tej samej maszyny | logger i daemon na jednym komputerze |
| `0.0.0.0` | ze wszystkich interfejsów, w tym **rozgłoszeniowe** | logger na innym komputerze w shacku, albo wysyłka na adres rozgłoszeniowy |

N1MM+, DXLog i pokrewne często wysyłają na adres **rozgłoszeniowy** sieci, a nie na
localhost — wtedy `127.0.0.1` nie odbierze nic. To najczęstsza przyczyna „nie działa".

> ⚠️ **`0.0.0.0` otwiera port na całą sieć lokalną.** Każdy w tej sieci może wtedy
> wysłać datagram, który daemon zapisze na Twoim PIN-ie do Twojej akcji. W sieci
> domowej to zwykle akceptowalne; w sieci publicznej lub klubowej — przemyśl to.

### Multicast
Niektóre loggery nadają na grupę multicast (WSJT-X domyślnie `224.0.0.222`):
```json
"udp": { "host": "0.0.0.0", "port": 12060, "multicastGroups": ["224.0.0.222"] }
```
Dołączenie do grupy wymaga `host: "0.0.0.0"`; przy innym bindzie daemon ostrzeże.

Sprawdzone: przy `0.0.0.0` odbierane są datagramy unicast na adres LAN, rozgłoszeniowe
i multicastowe.

### Zapora Windows
Przy pierwszym uruchomieniu Windows zapyta o zezwolenie dla Node/aplikacji na
przyjmowanie połączeń. Bez zgody dla **sieci prywatnej** datagramy z innych maszyn
nie dojdą.

### Katalog danych
`dataDir` decyduje, względem czego liczone są ścieżki z sekcji `queue`:

| Wartość | Baza |
|---|---|
| brak (domyślnie) | katalog programu — wygodne przy uruchamianiu z repozytorium |
| `"auto"` | katalog systemowy użytkownika |
| własna ścieżka | ta ścieżka |

`"auto"` daje: Windows `%APPDATA%\radiodyplom-bridge`, Linux
`~/.local/share/radiodyplom-bridge`, macOS `~/Library/Application Support/…`.
**Po zainstalowaniu aplikacji ustaw `"auto"`** — katalog w `Program Files` nie jest
zapisywalny, a kolejka musi mieć gdzie trwać.

### Autostart
- **Windows:** Harmonogram zadań — wyzwalacz „przy logowaniu", akcja: `node src\index.js`
  (albo plik wykonywalny po spakowaniu), „Uruchom niezależnie od tego, czy użytkownik
  jest zalogowany" tylko jeśli daemon ma działać bez sesji.
- **Linux:** usługa systemd użytkownika (`~/.config/systemd/user/`), `systemctl --user
  enable --now`.

Kolejka jest odporna na twarde ubicie procesu (zapis atomowy), więc restart maszyny
nie uszkodzi danych — niewysłane QSO zostaną dosłane po starcie.

## „Utracono łączność z API" przy działającym serwisie

Node daje domyślnie **250 ms** na próbę nawiązania połączenia z pierwszym
adresem hosta (Happy Eyeballs, `autoSelectFamilyAttemptTimeout`).
`radiodyplom.pl` ma adres IPv4 i IPv6, a samo połączenie zajmuje tam zwykle
**350–1200 ms** — czyli dłużej niż ten limit. Efekt: `fetch` przerywał próbę
i oddawał `ETIMEDOUT`, choć serwis odpowiadał.

Zmierzone 2026-09-04: przy domyślnych 250 ms padały 3 żądania z 3, przy 3000 ms
przechodziły 3 z 3. W logu zostawiało to serię wpisów „Utracono łączność z API"
bez żadnej realnej awarii. Mostek podnosi ten limit od wersji 0.1.10
(`src/radiodyplom.js`).

Kolejki to nie dotykało — QSO czekały i szły przy następnej próbie — ale
mylące wpisy w logu i czerwona ikona brały się właśnie z tego.
