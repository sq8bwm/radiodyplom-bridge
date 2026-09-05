# Mostek na Raspberry Pi (i innym komputerze bez monitora)

Rdzeń mostka to **czysty JavaScript bez żadnych zależności** — 232 kB kodu.
Nie potrzebuje Electrona ani środowiska graficznego, więc na małym komputerze
pracuje jako zwykła usługa systemowa.

Paczka `radiodyplom-bridge-headless` waży **64 kB** wobec 94 MB wersji
z interfejsem, i ma `Architecture: all` — ta sama działa na **arm64, armhf
i amd64**.

## Kiedy to ma sens

- **Logger na starym Windowsie.** Windows 7 i 8 nie uruchomią wersji
  z interfejsem ([dlaczego](windows-i-siec.md#windows-7-i-8--program-się-nie-uruchomi)),
  ale QSO i tak lecą po UDP — mostek może stać na malince obok.
- **Mostek ma działać zawsze**, także gdy komputer z loggerem jest wyłączony
  albo zabrany w teren.
- **Praca w klubie**, gdzie kilka stanowisk z loggerami wysyła do jednego
  mostka.

```
[stanowisko: QLog / N1MM / WSJT-X] ──UDP──► [Raspberry Pi: mostek] ──► radiodyplom.pl
```

## Czego potrzebujesz

- Raspberry Pi (albo cokolwiek z Linuksem) w tej samej sieci co logger
- **Node.js 18 lub nowszy**
- PIN API z radiodyplom.pl

## 1. Node.js

```bash
node --version || nodejs --version
```

Raspberry Pi OS (bookworm) ma w repozytorium Node 18 — wystarczy:

```bash
sudo apt update && sudo apt install -y nodejs
```

Na starszym systemie apt może dać Node 12 albo 14. Wtedy z NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

> W Debianie binarka bywa `node` **albo** `nodejs` — nazwa `node` była tam
> kiedyś zajęta przez pakiet krótkofalarski (*Amateur Packet Radio Node*).
> Mostek radzi sobie z obiema.

## 2. Instalacja mostka

```bash
wget https://github.com/SQ8BWM/radiodyplom-bridge/releases/latest/download/radiodyplom-bridge-headless_0.1.13_all.deb
sudo dpkg -i radiodyplom-bridge-headless_*.deb
```

Instalacja **nie uruchamia** usługi — bez PIN-u nie miałaby co robić.

Co się zakłada:

| Ścieżka | Co |
|---|---|
| `/usr/lib/radiodyplom-bridge/` | program |
| `/etc/radiodyplom-bridge/config.json` | ustawienia |
| `/etc/radiodyplom-bridge/pin.env` | **PIN**, prawa 0640 |
| `/var/lib/radiodyplom-bridge/` | kolejka i dziennik QSO |
| konto systemowe `radiodyplom` | usługa nie działa z prawami roota |

## 3. PIN

```bash
sudo nano /etc/radiodyplom-bridge/pin.env
```

```
RD_PIN=TWOJ-PIN
```

Bez cudzysłowów i bez spacji wokół `=`.

PIN leży **osobno od `config.json`**, z prawami `0640`, celowo: plik
konfiguracji bywa wklejany do zgłoszeń błędów i pokazywany na zrzutach ekranu,
a sekret nie ma prawa się tak rozejść.

## 4. Nasłuch z sieci

Domyślnie mostek słucha tylko siebie (`127.0.0.1`). Żeby przyjmował QSO
z innego komputera:

```bash
sudo nano /etc/radiodyplom-bridge/config.json
```

```json
"udp": { "host": "0.0.0.0", "port": 12060 }
```

> **Co to znaczy.** Port staje się otwarty dla całej sieci lokalnej — każdy
> w tej sieci może wtedy dopisać QSO do Twojej akcji. W domu zwykle w porządku;
> w sieci klubowej albo hotelowej warto się zastanowić i przynajmniej ograniczyć
> zaporą do adresu stanowiska.

Zapora, jeśli działa:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 12060 proto udp
```

Przy okazji ustaw **cele rozmnażania** (`forward.targets`), jeśli logujesz pod
kilkoma znakami — patrz [fan-out.md](fan-out.md).

## 5. Uruchomienie

```bash
sudo systemctl enable --now radiodyplom-bridge
systemctl status radiodyplom-bridge
```

W logu powinno być `PIN należy do profilu: …` i `Gotowe. Czekam na QSO`:

```bash
journalctl -u radiodyplom-bridge -f
```

## 6. Skierowanie loggera

W loggerze na stanowisku wpisz jako adres docelowy UDP **adres IP malinki**
zamiast `127.0.0.1` — port bez zmian, `12060`. Adres sprawdzisz na Pi:

```bash
hostname -I
```

Szczegóły dla poszczególnych loggerów: [loggery.md](loggery.md).

## 7. Sprawdzanie bez okna

Całe API stanu działa tak samo jak w wersji z interfejsem:

```bash
curl -s localhost:12061/api/status | jq '{wersja: .version, kolejka: .queue, konto: .radiodyplom.profile}'
curl -s localhost:12061/api/stats  | jq '.total'
curl -s "localhost:12061/api/stats?from=2026-09-01" | jq '.perDay'
curl -s localhost:12061/api/log    | jq -r '.entries[-10:][]'
```

Ponowienie odrzuconych bez klikania:

```bash
curl -s -X POST localhost:12061/api/requeue
```

> API słucha **wyłącznie na `127.0.0.1`**, niezależnie od `udp.host` — to
> interfejs sterujący wysyłką na Twoim PIN-ie. Żeby zajrzeć zdalnie, użyj
> tunelu SSH: `ssh -L 12061:localhost:12061 pi@malinka`.

## 8. Aktualizacja

```bash
wget https://github.com/SQ8BWM/radiodyplom-bridge/releases/latest/download/radiodyplom-bridge-headless_NOWA_all.deb
sudo dpkg -i radiodyplom-bridge-headless_*.deb
sudo systemctl restart radiodyplom-bridge
```

Konfiguracja i dane **nie są ruszane** — `postinst` nie nadpisuje istniejącego
`config.json` ani `pin.env`.

## 9. Odinstalowanie

```bash
sudo apt remove radiodyplom-bridge-headless          # program
sudo apt purge  radiodyplom-bridge-headless          # program + konfiguracja i PIN
```

**Dane QSO zostają** w `/var/lib/radiodyplom-bridge` także po `purge` — leży tam
dziennik wysłanych, czyli historia pracy w eterze. Usunięcie tego przy
odinstalowaniu programu byłoby stratą nie do odzyskania, a nikt się tego nie
spodziewa. Do skasowania ręcznie:

```bash
sudo rm -rf /var/lib/radiodyplom-bridge
```

## Uwagi

**Nie uruchamiaj obu wersji naraz na jednej maszynie.** Wersja z interfejsem
i usługa systemowa zajmowałyby ten sam port UDP; ta druga zgłosi wtedy jasny
błąd i się nie uruchomi, ale i tak nie ma to sensu.

**Kolejka przeżywa restart malinki.** QSO odebrane przy zerwanym internecie
czekają na dysku i idą same, gdy łączność wróci.

**Zegar.** Data QSO idzie z loggera, więc zegar malinki nie wpływa na to, co
trafia do akcji — ale wpływa na znaczniki czasu w logu i statystykach. Na Pi bez
zegarka warto mieć `systemd-timesyncd` (domyślnie jest).
