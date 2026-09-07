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
2. **Hasło do interfejsu** → co najmniej 8 znaków
3. **Tylko do odczytu** → zostaw zaznaczone, dopóki nie masz powodu inaczej
4. **Zapisz**, potem **zrestartuj program** (adres i HTTPS ustalane są przy starcie)

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

## Ustawienie w pliku (malinka bez pulpitu)

Na maszynie bez przeglądarki hasło można policzyć jednym poleceniem:

```bash
node -e "import('/usr/lib/radiodyplom-bridge/src/apiauth.js')
  .then(m => console.log(m.zahaszujHaslo(process.argv[1])))" 'twoje-haslo'
```

Wynik wklej do `/etc/radiodyplom-bridge/config.json`:

```json
"api": {
  "enabled": true,
  "port": 12061,
  "host": "0.0.0.0",
  "readOnly": true,
  "auth": { "passwordHash": "scrypt$…" },
  "tls": { "enabled": true, "certFile": null, "keyFile": null }
}
```

Potem `sudo systemctl restart radiodyplom-bridge` i wejście na
`https://adres-malinki:12061/`.

Zapora, jeśli masz włączoną:

```bash
sudo ufw allow from 192.168.0.0/16 to any port 12061 proto tcp
```

Adres sieci dopasuj do swojej — `ufw allow 12061` bez ograniczenia otwiera port
także dla gościa z telefonem w tej sieci.

---

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

W oknie widać to plakietką w nagłówku: **W SIECI · tylko odczyt** (zielona) albo
**W SIECI · Z PRAWEM ZAPISU** (czerwona).

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
