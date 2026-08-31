// Dekoder QLog: JSON z rekordem ADIF w data.value.
// {appid:"QLog", msgtype:"qso", time, logid, data:{operation, rowid, type:"adif", value}}
import { parseAdif } from '../adif.js';

export const name = 'QLog';

/** Czy ten dekoder rozpoznaje datagram? JSON zaczyna się od '{'. */
export function detect(buf) {
  return buf.length > 0 && buf[0] === 0x7b; // '{'
}

/**
 * @returns {{key:string, adif:object, meta:object} | null}
 */
export function decode(buf, { operations }) {
  let msg;
  try {
    msg = JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }

  if (msg.appid !== 'QLog' || msg.msgtype !== 'qso') return null;

  const d = msg.data || {};
  if (!operations.has(d.operation)) {
    return { skip: `operacja "${d.operation}"` };
  }
  if (d.type !== 'adif' || !d.value) return null;

  const adif = parseAdif(d.value);

  return {
    key: `qlog:${msg.logid || 'nolog'}#${d.rowid}`,
    adif,
    meta: {
      source: 'QLog',
      logid: msg.logid,
      rowid: d.rowid,
      operation: d.operation,
    },
  };
}
