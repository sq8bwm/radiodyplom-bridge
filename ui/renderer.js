// Interfejs. Nie ma tu żadnej logiki mostka — tylko prezentacja stanu
// i wysyłanie poleceń przez window.bridge (preload).
import { t, setLang, getLang, errText, LANGS, LANG_NAMES } from './strings.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

// ---------- język ----------
/** Wstawia tłumaczenia we wszystkie elementy z data-i18n. */
function applyLang() {
  document.documentElement.lang = getLang();
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  $('fPin').placeholder = getLang() === 'pl' ? 'np. ABCD-1234' : 'e.g. ABCD-1234';
  $('fMulticast').placeholder = t('hint.multicast');
  $('btnQuit').title = t('hint.closeToTray');
  refresh();
  if ($('konfig').classList.contains('active')) loadConfig();
}

function buildLangPicker(active) {
  const sel = $('langPick');
  sel.innerHTML = LANGS.map((l) => `<option value="${l}">${LANG_NAMES[l]}</option>`).join('');
  sel.value = active;
  sel.onchange = async () => {
    setLang(sel.value);
    applyLang();
    // Zapis do konfiguracji, żeby zasobnik i kolejny start znały wybór.
    await window.bridge.saveConfig({ language: sel.value });
  };
}

// ---------- zakładki ----------
document.querySelectorAll('nav button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('nav button').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('section').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    $(b.dataset.tab).classList.add('active');
    if (b.dataset.tab === 'konfig') loadConfig();
    if (b.dataset.tab === 'log') refreshLog();
  };
});

// ---------- stan ----------
function renderStatus(s) {
  if (!s) return;
  const paused = s.queue.paused;
  const bad = s.state === 'error';

  // Stan bierzemy gotowy z rdzenia – dokładnie ten sam, którym kieruje się
  // ikona w zasobniku. Kropka i plakietka nie mogą pokazywać czegoś innego.
  const dotClass = { ok: 'ok', warn: 'warn', error: 'err' }[s.state] || '';
  $('dot').className = `dot ${dotClass}`;
  $('dot').title = stateReason(s);

  const badge = $('profile');
  badge.className = `badge st-${s.state}`;
  badge.title = stateReason(s);
  if (s.radiodyplom.pinMissing) {
    badge.textContent = t('state.noPin');
  } else {
    const who = `${s.radiodyplom.profile || '—'} · ${s.radiodyplom.pin}`;
    badge.textContent = bad ? `${who} · ${t('state.noConn')}` : who;
  }
  // Banner jest sterowany STANEM, nie odpowiedzią na zapis — dzięki temu nie
  // ginie przy przełączeniu zakładki ani po ponownym otwarciu okna.
  const pend = s.pendingRestart || [];
  $('restartNote').hidden = pend.length === 0;
  if (pend.length) $('restartNote').textContent = t('restart.banner') + pend.join(', ');

  $('dryBadge').hidden = !s.radiodyplom.dryRun;
  $('btnPause').textContent = paused ? t('btn.resume') : t('btn.pause');

  $('cSent').textContent = s.queue.sent;
  $('cPending').textContent = s.queue.pending;
  $('cFailed').textContent = s.queue.failed;
  $('cRecv').textContent = s.listener.stats.received;
  $('cSkipped').textContent = s.queue.skipped ?? 0;
  $('logPath').textContent = s.logFile || '';

  const mc = s.listener.multicastGroups?.length
    ? ` · multicast: ${s.listener.multicastGroups.join(', ')}` : '';
  $('listenInfo').innerHTML = `<code>udp://${esc(s.listener.host)}:${s.listener.port}</code>${esc(mc)}`;
  $('localNote').hidden = !s.listener.localOnly;

  const by = s.listener.stats.bySource || {};
  const keys = Object.keys(by);
  $('sources').className = keys.length ? '' : 'empty';
  $('sources').innerHTML = keys.length
    ? keys.map((k) => `<div>${esc(k)}: <b>${by[k]}</b></div>`).join('')
    : t('empty.sources');

  const parts = [];
  if (s.lastSent) {
    parts.push(`<div>${t('msg.lastSent')}<b>${esc(s.lastSent.callsign)}</b> → ${esc(s.lastSent.station)}`
      + `${s.lastSent.savedTo ? ` (${t('msg.action')}${s.lastSent.savedTo.join(', ')})` : ''}</div>`);
  }
  if (s.lastError) {
    parts.push(`<div class="lvl-error">${t('msg.lastError')}${esc(s.lastError.callsign)} — `
      + `${esc(errText(s.lastError.code, s.lastError.error))}</div>`);
  }
  if (s.radiodyplom.pinMissing) {
    parts.push(`<div class="lvl-warn">${t('msg.noPinHint')}</div>`);
  } else if (bad && s.radiodyplom.pingError) {
    parts.push(`<div class="lvl-error">API: ${esc(s.radiodyplom.pingError)}</div>`);
  }
  $('lastInfo').innerHTML = parts.join('') || `<span class="empty">${t('empty.nothing')}</span>`;

  const row = (i) => [i.callsign, i.station, i.operator || '—', i.attempts,
    i.lastError ? errText(i.code, i.lastError) : '—'];
  fillTable('tPending', 'ePending', s.queue.pendingItems, row);
  fillTable('tFailed', 'eFailed', s.queue.failedItems, row);
}

/** Powód stanu tłumaczymy w UI; rdzeń podaje sam kod stanu. */
function stateReason(s) {
  if (s.queue.paused) return t('state.paused');
  if (s.state === 'error') return t('state.offline');
  if (s.queue.failed > 0) return `${t('state.rejected')}${s.queue.failed}`;
  return t('state.ok');
}

function fillTable(tbodyId, emptyId, items, cols) {
  const tb = $(tbodyId);
  tb.innerHTML = (items || []).map((i) => `<tr>${cols(i).map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
  $(emptyId).hidden = (items || []).length > 0;
}

async function refresh() {
  try { renderStatus(await window.bridge.status()); } catch { /* rdzeń wstaje */ }
}

// ---------- log ----------
async function refreshLog() {
  const entries = await window.bridge.log(200);
  $('logbox').innerHTML = entries.map((e) => {
    const time = e.ts.slice(11, 19);
    const extra = e.extra ? ' ' + esc(e.extra) : '';
    return `<span class="lvl-${e.level}">${time} ${esc(e.msg)}${extra}</span>`;
  }).join('\n');
  $('logbox').scrollTop = $('logbox').scrollHeight;
}

// ---------- konfiguracja ----------
async function loadConfig() {
  const cfg = await window.bridge.getConfig();
  if (!cfg) return;
  $('fPin').value = cfg.radiodyplom.pin || '';
  $('fDryRun').checked = cfg.radiodyplom.dryRun;
  $('fHost').value = cfg.udp.host;
  $('fPort').value = cfg.udp.port;
  $('fMulticast').value = (cfg.udp.multicastGroups || []).join(', ');
  renderOperators(cfg.operators || []);
  renderTargets(cfg.forward.targets || []);
}

// ---------- baza operatorów ----------
function renderOperators(list) {
  $('operators').innerHTML = list.map((o) => `
    <div class="op-row">
      <div><label>${t('label.opCall')}</label><input type="text" class="o-call" value="${esc(o.call || '')}" placeholder="SP0ABC"></div>
      <div><label>${t('label.opName')}</label><input type="text" class="o-name" value="${esc(o.name || '')}"></div>
      <div><label>${t('label.opPin')}</label><input type="text" class="o-pin" value="${esc(o.pin || '')}" placeholder="ABCD-1234"></div>
      <button class="act sec o-del">${t('btn.remove')}</button>
    </div>`).join('');
  $('operators').querySelectorAll('.o-del').forEach((b) => {
    b.onclick = () => { b.closest('.op-row').remove(); syncPinPickers(); };
  });
  // Poprawiony znak musi natychmiast trafić do list wyboru w fan-oucie,
  // inaczej wybór wskazywałby na nieistniejącego już operatora.
  $('operators').querySelectorAll('.o-call').forEach((i) => { i.onchange = syncPinPickers; });
}

function collectOperators() {
  return [...$('operators').querySelectorAll('.op-row')].map((row) => ({
    call: row.querySelector('.o-call').value.trim(),
    name: row.querySelector('.o-name').value.trim(),
    pin: row.querySelector('.o-pin').value.trim(),
  })).filter((x) => x.call);
}

$('btnAddOperator').onclick = () => {
  const current = collectOperators();
  current.push({ call: '', name: '', pin: '' });
  renderOperators(current);
};

/** Znaki z bazy, w postaci gotowej na listę wyboru. */
function operatorChoices() {
  return collectOperators().map((o) => ({
    call: o.call.toUpperCase(),
    label: o.name ? `${o.call.toUpperCase()} — ${o.name}` : o.call.toUpperCase(),
  }));
}

/** Buduje <option> listy PIN-u dla jednego celu. */
function pinOptions(selected, hasOwnPin) {
  const opts = [`<option value="">${esc(t('opt.mainPin'))}</option>`];
  for (const o of operatorChoices()) {
    const sel = o.call === String(selected || '').toUpperCase() ? ' selected' : '';
    opts.push(`<option value="${esc(o.call)}"${sel}>${esc(o.label)}</option>`);
  }
  // Cel z PIN-em wpisanym wprost w config.json obsługujemy dalej — ale nie
  // pokazujemy sekretu w interfejsie, tylko informujemy, że taki jest.
  if (hasOwnPin && !selected) {
    opts.push(`<option value="__own" selected>${esc(t('opt.ownPin'))}</option>`);
  }
  return opts.join('');
}

/** Odświeża listy wyboru po zmianie bazy, zachowując dotychczasowe wybory. */
function syncPinPickers() {
  const choices = operatorChoices().map((o) => o.call);
  $('targets').querySelectorAll('.t-pinfrom').forEach((sel) => {
    const keep = sel.value;
    const own = sel.dataset.own === '1';
    sel.innerHTML = pinOptions(choices.includes(keep) ? keep : '', own);
    sel.value = choices.includes(keep) ? keep : (own ? '__own' : '');
  });
  const none = choices.length === 0;
  $('fanoutNoOps').hidden = !(none && $('targets').querySelectorAll('.three').length > 0);
}

// ---------- cele fan-outu ----------
function renderTargets(list) {
  $('targets').innerHTML = list.map((x) => `
    <div class="three" style="margin-bottom:8px">
      <div><label>${t('label.stationCall')}</label><input type="text" class="t-station" value="${esc(x.station_callsign)}"></div>
      <div><label>${t('label.operator')}</label><input type="text" class="t-op" value="${esc(x.operator || '')}"></div>
      <div><label>${t('label.targetPin')}</label>
        <select class="t-pinfrom" data-own="${x.pinSet && !x.pinFrom ? '1' : '0'}">${pinOptions(x.pinFrom, x.pinSet)}</select></div>
      <button class="act sec t-del">${t('btn.remove')}</button>
    </div>`).join('');
  $('targets').querySelectorAll('.t-del').forEach((b) => {
    b.onclick = () => { b.closest('.three').remove(); syncPinPickers(); };
  });
  // Wybór operatora podpowiada znak stacji, gdy pole jest jeszcze puste —
  // najczęstszy przypadek to jedna osoba pracująca własnym znakiem.
  $('targets').querySelectorAll('.t-pinfrom').forEach((sel) => {
    sel.onchange = () => {
      const station = sel.closest('.three').querySelector('.t-station');
      if (!station.value.trim() && sel.value && sel.value !== '__own') station.value = sel.value;
    };
  });
  syncPinPickers();
}

$('btnAddTarget').onclick = () => {
  const current = collectTargets();
  current.push({ station_callsign: '', operator: '', pinFrom: '' });
  renderTargets(current);
};

function collectTargets() {
  return [...$('targets').querySelectorAll('.three')].map((row) => {
    const sel = row.querySelector('.t-pinfrom');
    const pick = sel ? sel.value : '';
    return {
      station_callsign: row.querySelector('.t-station').value.trim(),
      operator: row.querySelector('.t-op').value.trim(),
      // '__own' = zostaw PIN wpisany wprost w pliku; rdzeń rozpozna to po tym,
      // że nie przysyłamy ani pinFrom, ani nowego PIN-u.
      pinFrom: pick === '__own' ? '' : pick,
      pinSet: pick === '__own',
    };
  }).filter((x) => x.station_callsign);
}

$('btnSave').onclick = async () => {
  try {
    await saveFromForm();
  } catch (err) {
    // Cichy błąd zapisu byłby najgorszy: pola pokazywałyby nową wartość,
    // a na dysku zostałaby stara.
    $('saveInfo').textContent = `${t('hint.saveFailed')} ${err?.message || err}`;
    $('saveInfo').className = 'hint lvl-error';
  }
};

async function saveFromForm() {
  const r = await window.bridge.saveConfig({
    radiodyplom: { pin: $('fPin').value.trim(), dryRun: $('fDryRun').checked },
    udp: {
      host: $('fHost').value,
      port: Number($('fPort').value),
      multicastGroups: $('fMulticast').value.split(',').map((x) => x.trim()).filter(Boolean),
    },
    operators: collectOperators(),
    forward: { targets: collectTargets() },
  });
  $('saveInfo').textContent = r.restartRequired.length
    ? t('hint.savedRestart') + r.restartRequired.join(', ')
    : t('hint.saved');
  $('saveInfo').className = r.restartRequired.length ? 'hint lvl-warn' : 'hint';
  await loadConfig();
  refresh();
}

// ---------- akcje ----------
$('btnPause').onclick = async () => {
  const s = await window.bridge.status();
  await (s.queue.paused ? window.bridge.resume() : window.bridge.pause());
  refresh();
};
$('btnRequeue').onclick = async () => { await window.bridge.requeue(); refresh(); };
$('btnOpenLog').onclick = () => window.bridge.openLog();

$('btnQuit').onclick = async () => {
  // Potwierdzenie, bo zamknięcie przerywa przekazywanie QSO.
  if (window.confirm(t('confirm.quit'))) await window.bridge.quit();
};

// ---------- start ----------
(async () => {
  const cfg = await window.bridge.getConfig();
  setLang(cfg?.language || 'pl');
  buildLangPicker(getLang());
  applyLang();
  setInterval(refresh, 2000);
  setInterval(() => { if ($('log').classList.contains('active')) refreshLog(); }, 2000);
})();
