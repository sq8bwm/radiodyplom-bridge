#!/bin/sh
# Okno mostka na SYSTEMOWYM Electronie — to jest cały sens paczki ze źródeł:
# poprawki bezpieczeństwa Chromium przychodzą z pacmanem, a nie czekają na nasze
# następne wydanie.
#
# Wskazujemy KATALOG, a nie plik ui/main.js. Różnica nie jest kosmetyczna:
# przy pojedynczym pliku Electron nie zna nazwy aplikacji i nadaje oknu
# WM_CLASS "electron", przez co StartupWMClass we wpisie .desktop nie pasuje
# i środowisko graficzne nie kojarzy okna z pozycją w menu (zła ikona na pasku,
# rozbite grupowanie — i ani słowa błędu). Z katalogiem Electron czyta nazwę
# z package.json. Zmierzone 2026-10-01 w kontenerze Arch:
#   plik    → ("electron" "electron")
#   katalog → ("radiodyplom-bridge" "radiodyplom-bridge")
exec electron44 /usr/lib/radiodyplom-bridge "$@"
