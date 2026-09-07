# Interfejs w sieci: hasło i HTTPS

Jak otworzyć okno mostka z innego komputera albo z telefonu — i czego to kosztuje.

[← powrót do README](../README.md)

---

## Najpierw: może nie potrzebujesz tego wcale

Jeśli mostek stoi na malince, a Ty siedzisz przy komputerze z SSH, **tunel jest
prostszy i bezpieczniejszy** — nic nie otwierasz, ruch jest szyfrowany
i uwierzytelniony Twoim kluczem:

```bash
ssh -L 12061:localhost:12061 pi@malinka
```

Po tym `http://localhost:12061/` u siebie pokazuje okno mostka z malinki.
Szczegóły w [malinka.md](malinka.md).

Nasłuch w sieci ma sens, gdy chcesz wejść **z telefonu na kanapie** albo
z komputera bez klienta SSH.

---

## Co program wymaga, zanim cokolwiek otworzy

Udostępnienie w sieci wymaga **jednocześnie hasła i HTTPS**. Nie ma wyjątku
„tylko w mojej sieci":

- hasło po zwykłym HTTP jedzie **jawnym tekstem** — razem z nowym PIN-em, gdy
  wpiszesz go w zakładce Konfiguracja,
- HTTPS bez hasła szyfruje połączenie **z kimkolwiek**, kto trafi na port.

Brak któregokolwiek warunku i program **zostaje na `127.0.0.1`**, wypisując
powód w logu:

```
[ERROR] API: nasłuch na 0.0.0.0 ODRZUCONY — nie ustawiono hasła (api.auth.password). Zostaję na 127.0.0.1.
```

To jest celowe: otwarty port bez hasła jest gorszy niż brak funkcji, bo przez
`POST /api/config` można podmienić PIN i przekierować Twoje QSO na inne konto.

---

## Ustawienie z okna (zalecane)

Zakładka **Konfiguracja**, panel **Interfejs w sieci**:

1. **Kto może otworzyć interfejs** → `0.0.0.0 — cała sieć lokalna`
2. **Port interfejsu** → domyślnie `12061`; zmiana wymaga restartu i nowego
   adresu w przeglądarce
3. **Hasło do interfejsu** → co najmniej 8 znaków
4. **Tylko do odczytu** → zaznacza się samo po wybraniu adresu sieciowego;
   odznaczenie wymaga potwierdzenia, bo oddaje prawo zmiany PIN-u
5. **Zapisz**, potem **zrestartuj program** (adres, port i HTTPS ustalane są
   przy starcie)

Gotowy adres do wpisania na telefonie znajdziesz na zakładce **Stan**, w panelu
**Interfejs** — razem z portem. **Port jest ten sam co lokalnie**; HTTPS zmienia
tylko schemat adresu, nie numer portu.

Hasło zapisuje się jako **hasz scrypt**, nigdy jawnie — tak jak PIN nie wraca
z API w jawnej postaci. Certyfikat program wystawia sobie sam przy pierwszym
starcie w tym trybie, do `<katalog danych>/tls/` z prawami `0600`.

Po restarcie w logu znajdziesz odcisk certyfikatu:

```
[INFO] Odcisk certyfikatu (SHA-256): 67:5C:D8:31:…
```

Warto go raz porównać z tym, co pokaże przeglądarka — to jedyny sposób, żeby się
upewnić, że łączysz się z własnym mostkiem, a nie z kimś, kto się pod niego
podszył.

---

## Ustawienie w pliku — urządzenie bez monitora

Na malince nie ma okna, w którym dałoby się wpisać hasło, więc hasz trzeba
policzyć samemu. Poniższe polecenia są sprawdzone na zainstalowanej paczce
`radiodyplom-bridge-headless`.

### 1. Policz hasz hasła

```bash
read -rsp 'Hasło do interfejsu: ' H; echo
H="$H" node -e "import('/usr/lib/radiodyplom-bridge/src/apiauth.js')
  .then(m => console.log(m.zahaszujHaslo(process.env.H)))"
unset H
```

Wypisze coś takiego — to jest **cała** wartość do wklejenia:

```
scrypt$8207852863a4208ef6548f1bc5a24b3e$2ed1f3ee87880acf6b956745fde87aa0e3ac8e2ced0af5444cce7948ea2925de
```

Dwie uwagi do samego polecenia:

- `read -rsp` **nie wypisuje hasła na ekran** i nie zostawia go w historii
  powłoki. Wariant z hasłem wpisanym wprost w wiersz polecenia zostawia je
  i w historii, i w `ps` — widocznym dla innych użytkowników maszyny.
- Jeśli `node` nie jest znane, użyj `nodejs` (paczka wymaga Node ≥ 18;
  program uruchamia się przez wrapper, który sprawdza obie nazwy).

Hasło musi mieć **co najmniej 8 znaków** — krótsze polecenie odrzuci
komunikatem, a nie po cichu.

### 2. Wklej do konfiguracji

```bash
sudo nano /etc/radiodyplom-bridge/config.json
```

Sekcja `api` ma wyglądać tak:

```json
"api": {
  "enabled": true,
  "port": 12061,
  "host": "0.0.0.0",
  "readOnly": true,
  "auth": { "passwordHash": "scrypt$8207…2925de" },
  "tls": { "enabled": true, "certFile": null, "keyFile": null }
}
```

`readOnly: true` zostaw, dopóki nie masz powodu inaczej — z telefonu zobaczysz
statystyki i stan, a nikt nie zmieni PIN-u.

### 3. Zamknij prawa do pliku konfiguracji

**To jest krok, którego nie wolno pominąć.** Instalator nadaje
`config.json` prawa `0644`, czyli **do czytania dla każdego użytkownika
maszyny** — bo dotąd nie było w nim niczego wrażliwego (PIN celowo mieszka
osobno, w `pin.env` z prawami `0640`).

Hasz hasła to nie hasło, ale wystarcza, żeby łamać je **offline**, bez limitów
i bez śladu w logach. Skoro więc do pliku trafia, plik trzeba zamknąć:

```bash
sudo chmod 0640 /etc/radiodyplom-bridge/config.json
sudo chown root:radiodyplom /etc/radiodyplom-bridge/config.json
```

Usługa nadal go przeczyta — działa jako użytkownik `radiodyplom`, który należy
do grupy `radiodyplom`. Aktualizacja paczki tego nie cofnie: instalator tworzy
`config.json` tylko wtedy, gdy go nie ma.

### 4. Uruchom ponownie i sprawdź

```bash
sudo systemctl restart radiodyplom-bridge
journalctl -u radiodyplom-bridge -n 30 --no-pager
```

Szukasz trzech linii:

```
[INFO] TLS: wystawiony certyfikat własny na malinka (DNS:localhost,DNS:malinka,IP:127.0.0.1,IP:192.168.8.50)
[INFO] API stanu na https://0.0.0.0:12061/api/status
[WARN] Interfejs jest widoczny w sieci lokalnej. Wymagane hasło, tryb tylko do odczytu.
```

Jeśli zamiast tego widzisz `ODRZUCONY`, mostek został na localhoście i podaje
powód — będzie to jedno z trzech: brak hasła, wyłączony TLS albo brak
certyfikatu (i wtedy: brak `openssl`).

### 5. Zapisz odcisk certyfikatu

```bash
journalctl -u radiodyplom-bridge | grep "Odcisk certyfikatu" | tail -1
```

Przy pierwszym wejściu przeglądarka spyta o zaufanie — **to jedyny moment**,
w którym możesz porównać odcisk i upewnić się, że łączysz się z własną malinką.
Warto go wtedy mieć pod ręką.

### 6. Adres do wpisania na telefonie

```bash
hostname -I
```

Pierwszy adres z listy plus port, czyli na przykład `https://192.168.8.50:12061/`.
**Port jest ten sam co przy HTTP** — HTTPS zmienia tylko schemat.

### Gdzie co leży

| Ścieżka | Co to |
|---|---|
| `/etc/radiodyplom-bridge/config.json` | konfiguracja, w tym hasz hasła (zamknij na `0640`) |
| `/etc/radiodyplom-bridge/pin.env` | PIN API, osobno, `0640` |
| `/var/lib/radiodyplom-bridge/tls/` | certyfikat i klucz (`key.pem` z prawami `0600`) |
| `/var/lib/radiodyplom-bridge/data/bridge.log` | log mostka |

Certyfikat możesz w każdej chwili skasować — powstanie nowy przy następnym
starcie, ale wtedy zmieni się odcisk i przeglądarka spyta o zaufanie ponownie.

### Zapora

```bash
sudo ufw allow from 192.168.0.0/16 to any port 12061 proto tcp
```

Adres sieci dopasuj do swojej. Samo `sudo ufw allow 12061` otwiera port dla
**wszystkiego**, co trafi na ten interfejs — także dla telefonu gościa w tej
sieci.

## Tryb tylko do odczytu

**Domyślny przy nasłuchu w sieci** i w większości wypadków wystarczający:
statystyki, stan, kolejka i log — tak; jakakolwiek zmiana — nie.

| | tylko do odczytu | z prawem zapisu |
|---|---|---|
| podgląd statystyk i stanu | ✅ | ✅ |
| wstrzymanie przekazywania | ❌ | ✅ |
| zmiana konfiguracji i PIN-u | ❌ | ✅ |
| usunięcie odrzuconych QSO | ❌ | ✅ |

Zapis w sieci wymaga **jawnego** odznaczenia „Tylko do odczytu". Wtedy każdy,
kto zna hasło, może z telefonu zmienić Twój PIN — świadoma decyzja, nie domyślna.

W oknie widać to **ikoną kłódki** w nagłówku: zamknięta i zielona = tylko
odczyt, otwarta i czerwona = prawo zapisu. Najedź kursorem — dymek podaje pełny
opis razem z adresami. Ikony nie ma w ogóle, dopóki interfejs siedzi na
localhoście.

---

## Czego ten certyfikat NIE robi

Certyfikat wystawiony przez sam program **nie jest podpisany przez żaden urząd**.
Przeglądarka nie ma czym go sprawdzić, więc:

- ✅ **chroni treść na kablu** — hasło i QSO nie jadą jawnym tekstem,
- ❌ **nie chroni przed podszyciem się** pod Twój mostek w tej samej sieci; ktoś,
  kto przechwyci ruch, może podstawić własny certyfikat, a przeglądarka spyta
  o zaufanie tak samo jak przy Twoim.

Dlatego warto raz porównać odcisk z logu. I dlatego ostrzeżenie przeglądarki
przy pierwszym wejściu **nie jest formalnością** — jest jedynym momentem, w którym
decydujesz, czemu ufasz.

Kto chce certyfikatu bez ostrzeżeń, podaje własny:

```json
"tls": { "enabled": true, "certFile": "/etc/ssl/moj.crt", "keyFile": "/etc/ssl/moj.key" }
```

---

## Droga dla zaawansowanych: odwrotne proxy

Jeśli masz już nginxa albo Caddy, zostaw mostek na `127.0.0.1` i postaw proxy
przed nim. Wtedy certyfikatem, logowaniem i nagłówkami zajmuje się narzędzie
zrobione do tego, a mostek nie musi o niczym wiedzieć.

Caddy, dwie linijki i certyfikat od Let's Encrypt (wymaga publicznej nazwy
i przekierowania portu na routerze):

```caddyfile
mostek.example.org {
    basic_auth {
        marek <hasz-z-caddy-hash-password>
    }
    reverse_proxy 127.0.0.1:12061
}
```

To jest bezpieczniejsze od certyfikatu własnego, ale wymaga publicznej domeny
i wystawienia shacku do internetu — czyli innego zestawu ryzyk. Wybór należy
do Ciebie.

---

## Co się dzieje przy błędnym haśle

Po **pięciu** nieudanych próbach z jednego adresu logowanie jest blokowane na
minutę, a każda kolejna seria podwaja karę do 15 minut. Blokada dotyczy też
prawidłowego hasła — inaczej byłaby bez sensu.

Każda nieudana próba trafia do logu z adresem:

```
[WARN] Nieudane logowanie do interfejsu z 192.168.8.44 — blokada na 60 s
```

Warto tam zajrzeć, jeśli mostek stoi w sieci, do której ma dostęp ktoś jeszcze.
