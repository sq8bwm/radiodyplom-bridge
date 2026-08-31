#!/usr/bin/env node
// Generuje SHA256SUMS dla artefaktów w release/.
//
// Po co: nie podpisujemy instalatorów certyfikatem (patrz BACKLOG), więc suma
// kontrolna jest jedynym sposobem, w jaki odbiorca może sprawdzić, że pobrał
// dokładnie to, co zbudowaliśmy.
//
// Format jest zgodny z sha256sum, więc weryfikacja to:
//   sha256sum -c SHA256SUMS
import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RELEASE = join(ROOT, 'release');
const OUT = join(RELEASE, 'SHA256SUMS');

// Tylko gotowe artefakty do rozdania. Pliki pomocnicze electron-buildera
// (.blockmap, latest*.yml) i katalogi *-unpacked pomijamy.
const ARTIFACT = /\.(exe|AppImage|deb|rpm|zip|dmg|msi|snap|tar\.gz)$/i;

function sha256(path) {
  return new Promise((res, rej) => {
    const h = createHash('sha256');
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('error', rej)
      .on('end', () => res(h.digest('hex')));
  });
}

const human = (b) => (b >= 1 << 30 ? `${(b / (1 << 30)).toFixed(1)} GB`
  : `${Math.round(b / (1 << 20))} MB`);

if (!existsSync(RELEASE)) {
  console.error('Brak katalogu release/ — najpierw zbuduj paczki (npm run pack).');
  process.exit(1);
}

const files = readdirSync(RELEASE)
  .filter((f) => ARTIFACT.test(f))
  .filter((f) => statSync(join(RELEASE, f)).isFile())
  .sort();

if (files.length === 0) {
  console.error('W release/ nie ma artefaktów do policzenia.');
  process.exit(1);
}

const lines = [];
for (const f of files) {
  const full = join(RELEASE, f);
  const hash = await sha256(full);
  // dwa odstępy = tryb binarny sha256sum
  lines.push(`${hash}  ${f}`);
  console.log(`  ${hash.slice(0, 16)}…  ${human(statSync(full).size).padStart(6)}  ${f}`);
}

writeFileSync(OUT, `${lines.join('\n')}\n`);
console.log(`\nZapisano ${files.length} sum do ${OUT}`);
console.log('Weryfikacja u odbiorcy:  cd release && sha256sum -c SHA256SUMS');
