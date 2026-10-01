#!/bin/sh
# Rdzeń bez okna: ani Electrona, ani X/Wayland. Tego używa jednostka systemd.
exec node /usr/lib/radiodyplom-bridge/src/index.js "$@"
