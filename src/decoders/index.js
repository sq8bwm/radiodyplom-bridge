// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// Rejestr dekoderów + automatyczne rozpoznanie formatu po zawartości datagramu.
// Rodziny są rozłączne w pierwszych bajtach:
//   '{'            → JSON (QLog)
//   '<'            → XML  (N1MM, DXLog, BBlogger, Log4OM)
//   AD BC CB DA    → binarny QDataStream (WSJT-X, JTDX, MSHV)
import * as qlog from './qlog.js';
import * as n1mm from './n1mm.js';
import * as wsjtx from './wsjtx.js';

export const DECODERS = [wsjtx, qlog, n1mm];

/** @returns {object|null} dekoder, który rozpoznaje ten datagram */
export function pickDecoder(buf) {
  for (const d of DECODERS) {
    try {
      if (d.detect(buf)) return d;
    } catch { /* dekoder nie rozpoznaje – próbujemy dalej */ }
  }
  return null;
}

export const DECODER_NAMES = DECODERS.map((d) => d.name);
