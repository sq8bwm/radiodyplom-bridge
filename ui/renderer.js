// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

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
  // Podpowiedź, bo to nieoczywiste i kosztowne: QSO przepuszczone próbnie
  // jest zamknięte w deduplikacji i NIE poleci po wyłączeniu trybu próbnego.
  $('dryBadge').title = t('hint.dryRun');
  $('btnPause').textContent = paused ? t('btn.resume') : t('btn.pause');

  $('cSent').textContent = s.queue.sent;
  // W trybie próbnym nic nie poleciało, więc sama etykieta „wysłane" myli.
  document.querySelector('[data-i18n="card.sent"]').textContent =
    s.radiodyplom.dryRun ? `${t('card.sent')} ${t('card.sentDry')}` : t('card.sent');
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

  renderEvents(s);
  renderProblems(s);

  renderAbout(s);

  const row = (i) => [i.callsign, i.station, i.operator || '—', i.attempts,
    i.lastError ? errText(i.code, i.lastError) : '—'];
  fillTable('tPending', 'ePending', s.queue.pendingItems, row);
  fillTable('tFailed', 'eFailed', s.queue.failedItems, row);
}

/** Jak opisać i pokolorować jedno zdarzenie z kolejki. */
function describeEvent(e) {
  const who = `<b>${esc(e.callsign)}</b> → ${esc(e.station)}`;
  const op = e.operator ? ` (${esc(e.operator)})` : '';
  switch (e.kind) {
    case 'sent':
      return { cls: '', text: `${t('ev.sent')} ${who}${op}`
        + (e.savedTo?.length ? ` — ${t('msg.action')}${esc(e.savedTo.join(', '))}` : '') };
    case 'dryrun':
      // Osobny wiersz i osobny kolor: nic nie poleciało na serwer.
      return { cls: 'warn', text: `${t('ev.dryrun')} ${who}${op}` };
    case 'duplicate':
      return { cls: 'dup', text: `${t('ev.duplicate')} ${who}${op}` };
    case 'retry':
      return { cls: 'warn', text: `${t('ev.retry')} ${who}${op} — ${esc(errText(e.code, e.error))}` };
    case 'rejected':
      return { cls: 'bad', text: `${t('ev.rejected')} ${who}${op} — ${esc(errText(e.code, e.error))}` };
    case 'exhausted':
      return { cls: 'bad', text: `${t('ev.exhausted')} ${who}${op} — ${esc(errText(e.code, e.error))}` };
    default:
      return { cls: '', text: `${esc(e.kind)} ${who}` };
  }
}

function renderEvents(s) {
  const list = [...(s.recentEvents || [])].reverse();      // najnowsze u góry
  const extra = [];
  if (s.radiodyplom.pinMissing) {
    extra.push(`<li class="bad"><span class="what">${t('msg.noPinHint')}</span></li>`);
  } else if (s.state === 'error' && s.radiodyplom.pingError) {
    extra.push(`<li class="bad"><span class="what">API: ${esc(s.radiodyplom.pingError)}</span></li>`);
  }

  if (!list.length && !extra.length) {
    $('lastInfo').innerHTML = `<span class="empty">${t('empty.nothing')}</span>`;
    return;
  }
  $('lastInfo').innerHTML = `<ul class="events">${extra.join('')}${
    list.map((e) => {
      const d = describeEvent(e);
      return `<li class="${d.cls}"><time>${esc(String(e.at).slice(11, 19))}</time>`
        + `<span class="what">${d.text}</span></li>`;
    }).join('')}</ul>`;
}

/**
 * Sygnalizacja problemów. Plakietka w nagłówku trwa do potwierdzenia, bo QSO
 * bywa odrzucane przy zamkniętym oknie — inaczej informacja przepadałaby
 * razem z oknem.
 */
function renderProblems(s) {
  const p = s.problems || { count: 0 };
  const badge = $('probBadge');
  badge.hidden = !p.count;
  if (p.count) {
    badge.textContent = `${t('badge.problems')} ${p.count}`;
    const last = p.last
      ? `${p.last.callsign} → ${p.last.station}: ${errText(p.last.code, p.last.error)}`
      : '';
    badge.title = `${last}\n${t('hint.problemBadge')}`;
  }
  $('btnAckProblems').hidden = !p.count;
  // Usuwanie zależy od tego, czy COKOLWIEK leży w odrzuconych — także wtedy,
  // gdy sygnalizacja jest już potwierdzona.
  $('btnDiscardFailed').hidden = !s.queue.failed;
  $('ackHint').textContent = p.count ? t('hint.ackProblems') : '';
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

// ---------- o programie ----------
// Wszystko bierzemy ze statusu, czyli z package.json. Nic tu nie jest wpisane
// na sztywno — inaczej wersja w oknie rozjechałaby się z nazwą instalatora.
let about = null;

function renderAbout(s) {
  about = {
    version: s.version,
    repository: s.repository,
    license: s.license,
  };
  const rows = [
    [t('about.program'), `${esc(s.app || '—')}`],
    [t('about.version'), `<b>${esc(s.version || '—')}</b>`],
    [t('about.author'), esc(s.author || '—')],
    [t('about.license'), esc(s.license || '—')],
  ];
  $('aboutInfo').innerHTML = `<dl class="kv">${
    rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;

  // Zdanie o braku gwarancji — dla GPL właściwe miejsce w programie z okienkiem.
  $('licenseInfo').innerHTML = `<div>${t('about.gpl')}</div>`;
  $('btnLicense').disabled = !s.repository;
  $('btnRepo').disabled = !s.repository;
  $('btnReleases').disabled = !s.repository;
}

$('btnLicense').onclick = () => {
  if (about?.repository) window.bridge.openUrl(`${about.repository}/blob/main/LICENSE`);
};
$('btnRepo').onclick = () => {
  if (about?.repository) window.bridge.openUrl(about.repository);
};
$('btnReleases').onclick = () => {
  if (about?.repository) window.bridge.openUrl(`${about.repository}/releases`);
};

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
  $('fEvents').value = cfg.ui?.recentEvents ?? 20;
  renderTargets(cfg.forward.targets || []);
}

// ---------- wielkie litery w polach znaku ----------
/**
 * Wymusza wielkie litery w polu, nie gubiąc miejsca kursora.
 * Samo `text-transform` w CSS zmienia tylko wygląd — wartość zostawałaby
 * małymi literami, więc to, co widać, różniłoby się od tego, co zapisane.
 */
function forceUpper(input) {
  input.classList.add('callsign');
  input.addEventListener('input', () => {
    const up = input.value.toUpperCase();
    if (up === input.value) return;
    const { selectionStart: s, selectionEnd: e } = input;
    input.value = up;
    try { input.setSelectionRange(s, e); } catch { /* pole bez zaznaczenia */ }
  });
}

// ---------- cele fan-outu ----------
function renderTargets(list) {
  $('targets').innerHTML = list.map((x) => `
    <div class="three" style="margin-bottom:8px">
      <div><label>${t('label.stationCall')}</label><input type="text" class="t-station" value="${esc(x.station_callsign)}" placeholder="SN0ABC"></div>
      <div><label>${t('label.operator')}</label><input type="text" class="t-op" value="${esc(x.operator || '')}" placeholder="SQ8BWM"></div>
      <button class="act sec t-del">${t('btn.remove')}</button>
    </div>`).join('');
  $('targets').querySelectorAll('.t-station, .t-op').forEach(forceUpper);
  $('targets').querySelectorAll('.t-del').forEach((b) => {
    b.onclick = () => { b.closest('.three').remove(); };
  });
}

$('btnAddTarget').onclick = () => {
  const current = collectTargets({ validate: false });
  current.push({ station_callsign: '', operator: '' });
  renderTargets(current);
};

/**
 * Czyta cele z formularza. Znak stacji jest wymagany, więc przy validate:true
 * brakujące pole jest zaznaczane i zwracany jest null. Ciche pomijanie
 * niepełnego wiersza byłoby najgorsze: użytkownik widziałby stację w oknie,
 * a QSO by tam nie leciały.
 */
function collectTargets({ validate = true } = {}) {
  const rows = [...$('targets').querySelectorAll('.three')];
  let bad = false;
  const out = rows.map((row) => {
    const stationEl = row.querySelector('.t-station');
    const station = stationEl.value.trim().toUpperCase();
    if (validate) {
      stationEl.classList.toggle('invalid', !station);
      if (!station) bad = true;
    }
    return {
      station_callsign: station,
      operator: row.querySelector('.t-op').value.trim().toUpperCase(),
    };
  });
  if (validate && bad) return null;
  return out.filter((x) => x.station_callsign);
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
  const targets = collectTargets();
  if (targets === null) {
    // Zapis wstrzymany, a nie wykonany po cichu z pominięciem wiersza.
    $('saveInfo').textContent = t('hint.targetIncomplete');
    $('saveInfo').className = 'hint lvl-error';
    return;
  }
  const r = await window.bridge.saveConfig({
    radiodyplom: { pin: $('fPin').value.trim(), dryRun: $('fDryRun').checked },
    udp: {
      host: $('fHost').value,
      port: Number($('fPort').value),
      multicastGroups: $('fMulticast').value.split(',').map((x) => x.trim()).filter(Boolean),
    },
    ui: { recentEvents: Number($('fEvents').value) },
    forward: { targets },
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
$('btnAckProblems').onclick = async () => { await window.bridge.ackProblems(); refresh(); };
$('btnDiscardFailed').onclick = async () => {
  // Trwałe usunięcie łączności – pytamy z podaniem liczby i bez owijania.
  const s = await window.bridge.status();
  const n = s?.queue?.failed ?? 0;
  if (!n) return;
  if (!window.confirm(t('confirm.discardFailed').replace('{n}', n))) return;
  const r = await window.bridge.discardFailed();
  $('ackHint').textContent = `${t('hint.discarded')} ${r.removed}`;
  refresh();
};
// Plakietka kasuje sygnalizację po potwierdzeniu — bo właśnie po nią sięga
// ręka, gdy chce się „odkliknąć" ostrzeżenie. Potwierdzenie chroni przed
// przypadkowym trafieniem w nagłówek.
$('probBadge').onclick = async () => {
  if (!window.confirm(t('confirm.ackProblems'))) return;
  await window.bridge.ackProblems();
  refresh();
};
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
