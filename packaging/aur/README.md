# Paczka dla Arch Linuksa (AUR)

Pliki do zbudowania pakietu **`radiodyplom-bridge`** — budowanego **ze źródeł**,
w odróżnieniu od `radiodyplom-bridge-bin`, która pakuje gotowy AppImage.

## Czym się różni od paczki -bin

| | `radiodyplom-bridge` (tu) | `radiodyplom-bridge-bin` |
|---|---|---|
| Electron | **systemowy** (`electron44`) | własny, w AppImage |
| poprawki Chromium | z pacmanem | dopiero przy naszym następnym wydaniu |
| rozmiar | setki kilobajtów | ok. 120 MB |
| `--no-sandbox` | niepotrzebny | wymagany (AppImage nie ma jak użyć sandboksa) |
| tryb bez okna | jest, z jednostką systemd | nie ma |

Obie mają sens i mogą istnieć obok siebie w AUR; `conflicts` pilnuje tylko tego,
żeby nie instalować ich jednocześnie (obie dają `/usr/bin/radiodyplom-bridge`).

## Zanim to trafi do AUR: wymagane wydanie 0.1.34 lub nowsze

`PKGBUILD` ma na razie `pkgver=0.1.33`, ale **tej wersji nie wolno opublikować**:
archiwum z tagu `v0.1.33` zawiera jeszcze twardy `import` modułu `js-yaml`
w `test/desktop-entry.test.js`, więc `check()` pada, a z nim cała budowa.
Poprawka (miękki import i pomijanie tych sześciu testów) weszła po tym wydaniu.

Przy publikacji: `pkgver` na pierwsze wydanie zawierające poprawkę i nowa suma
archiwum — przepis niżej.

## Budowanie i test

Bez Archa pod ręką — w kontenerze:

```bash
docker run --rm -v "$PWD":/praca:ro archlinux:latest bash -c '
  pacman -Syu --noconfirm --needed base-devel namcap electron44 nodejs sudo
  useradd -m budowniczy && cp -r /praca /home/budowniczy/paczka
  chown -R budowniczy: /home/budowniczy/paczka
  sudo -u budowniczy bash -c "cd /home/budowniczy/paczka && makepkg -sf --noconfirm"
  namcap /home/budowniczy/paczka/*.pkg.tar.*
  pacman -U --noconfirm /home/budowniczy/paczka/*.pkg.tar.*'
```

`check()` uruchamia pełny zestaw testów (bez sieci, potrzebny tylko loopback).
`makepkg` odmawia pracy jako root i dobrze — dwa testy sprawdzają odmowę zapisu,
którą root ignoruje.

## Przy nowym wydaniu

1. `pkgver` na nowy numer, `pkgrel=1`,
2. nowa suma archiwum z tagu:
   ```bash
   curl -sL https://github.com/sq8bwm/radiodyplom-bridge/archive/refs/tags/v<WERSJA>.tar.gz | sha256sum
   ```
3. zbudować i zainstalować w kontenerze (wyżej),
4. `makepkg --printsrcinfo > .SRCINFO` — **bez tego AUR pokazuje stare dane**,
   nawet gdy PKGBUILD jest już poprawiony,
5. wypchnąć do repozytorium AUR.

`.SRCINFO` nie jest trzymane w tym katalogu: powstaje przy wypychaniu do AUR
i trzymanie dwóch kopii kończy się tym, że się rozjeżdżają.
