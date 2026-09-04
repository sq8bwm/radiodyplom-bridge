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
    // Statystyki liczone są przy odpytaniu, więc odświeżamy przy wejściu —
    // ale NIE w pętli, bo to przejście po całym dzienniku.
    if (b.dataset.tab === 'stats') refreshStats();
    if (b.dataset.tab === 'log') {
      // Wejście w zakładkę zawsze pokazuje najnowsze wpisy.
      lastLogHtml = '';
      // Dwa kroki: najpierw treść i wysokość, POTEM skok na koniec. Odwrotnie
      // scrollHeight jest jeszcze sprzed układu i skok trafia w próżnię.
      refreshLog().then(() => requestAnimationFrame(() => {
        fitLogBox();
        const el = $('logbox');
        el.scrollTop = el.scrollHeight;
        updateLogFollow();
      }));
    }
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

  renderCards(s);
  $('logPath').textContent = s.logFile || '';

  const mc = s.listener.multicastGroups?.length
    ? ` · multicast: ${s.listener.multicastGroups.join(', ')}` : '';
  $('listenInfo').innerHTML = `<code>udp://${esc(s.listener.host)}:${s.listener.port}</code>${esc(mc)}`;
  $('localNote').hidden = !s.listener.localOnly;

  const by = s.listener.stats.bySource || {};
  const keys = Object.keys(by);
  const nd = s.listener.notDecoded || {};
  // Datagramy, z których QSO nie powstało. Wcześniej różnica między „odebrane"
  // a tym panelem nie była widoczna nigdzie — w logu siedziała na DEBUG.
  const nieodczytane = nd.total
    ? `<div style="margin-top:6px">${t('sources.notDecoded').replace('{n}', nd.total)}
         <span class="hint">(${t('sources.ndUnknown').replace('{n}', nd.unknown || 0)}
         · ${t('sources.ndInvalid').replace('{n}', nd.invalid || 0)}
         · ${t('sources.ndSkipped').replace('{n}', nd.skipped || 0)})</span></div>`
    : '';
  $('sources').className = keys.length ? '' : 'empty';
  $('sources').innerHTML = keys.length
    ? keys.map((k) => `<div>${esc(k)}: <b>${by[k]}</b></div>`).join('') + nieodczytane
    : t('empty.sources') + nieodczytane;

  renderEvents(s);
  renderProblems(s);
  renderAccount(s);
  paintTargetChecks(s.forward?.targets);

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

/**
 * Karty liczbowe na zakładce Stan.
 *
 * Każda karta mówi w drugiej linii, CZEGO liczy i za jaki czas. Wcześniej
 * licznik trwały („wysłane", liczący kopie fan-outu od początku) stał w jednym
 * rzędzie z licznikiem procesu („odebrane z loggera”) i wyglądał na to samo —
 * realnie pokazywały 1119 przy 191.
 */
function renderCards(s) {
  const sesja = s.session || {};
  const nd = s.listener.notDecoded || {};

  // WYSŁANE: licznik trwały, w kopiach. Przejścia próbne mają własny licznik,
  // bo QSO, które nie opuściło komputera, nie jest wysłane.
  $('cSent').textContent = s.queue.sent;
  // Druga linia mówi WYŁĄCZNIE o tej sesji — mieszanie jej z licznikiem
  // trwałym byłoby powtórzeniem błędu, który właśnie naprawiamy.
  let podSent = t('sub.sentSession').replace('{n}', sesja.copies ?? 0);
  if (sesja.duplicates) podSent += t('sub.sentDuplicates').replace('{n}', sesja.duplicates);
  if (sesja.dryRun) podSent += t('sub.sentDry').replace('{n}', sesja.dryRun);
  $('sSent').textContent = podSent;
  $('kSent').title = s.queue.dryRun
    ? `${t('tip.sent')} ${t('tip.sentDryTotal').replace('{n}', s.queue.dryRun)}`
    : t('tip.sent');

  $('cPending').textContent = s.queue.pending;
  $('sPending').textContent = t('sub.onDisk');
  $('kPending').title = t('tip.pending');

  $('cFailed').textContent = s.queue.failed;
  $('sFailed').textContent = t('sub.onDisk');
  $('kFailed').title = t('tip.failed');

  // ODEBRANE: liczymy QSO, nie datagramy — dopiero wtedy ta karta jest
  // porównywalna z panelem ŹRÓDŁA. Datagramy schodzą do drugiej linii.
  $('cRecv').textContent = sesja.qso ?? 0;
  $('sRecv').textContent = t('sub.datagrams')
    .replace('{r}', sesja.received ?? 0)
    .replace('{n}', nd.total ?? 0);
  $('kRecv').title = t('tip.received');

  $('cSkipped').textContent = s.queue.skipped ?? 0;
  $('sSkipped').textContent = t('sub.session');
  $('kSkipped').title = t('tip.skipped');
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
  // Podpowiedzi nie nadpisujemy w pętli odświeżania — pokazuje wynik ostatniej
  // akcji i gaśnie sama (patrz flashHint).
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

// Ostatni znany stan. Trzymamy go, żeby po odrysowaniu formularza celów
// (dodanie albo usunięcie wiersza) domalować znaczniki uprawnień od razu,
// a nie po najbliższym odświeżeniu — inaczej gasną i wyglądają na zepsute.
let ostatniStatus = null;

async function refresh() {
  try {
    ostatniStatus = await window.bridge.status();
    renderStatus(ostatniStatus);
  } catch { /* rdzeń wstaje */ }
}

/**
 * Pokazuje wynik akcji i gasi go po chwili. Bez gaszenia „Przywrócono 3"
 * wisiałoby w oknie godzinami i po czasie wprowadzało w błąd.
 */
let hintTimer = null;
function flashHint(text) {
  $('ackHint').textContent = text;
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { $('ackHint').textContent = ''; }, 12000);
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
/**
 * Dopasowuje wysokość pola logu do okna. Liczona z faktycznego położenia
 * pola, a nie z wpisanej z góry liczby — nagłówek potrafi się zawinąć
 * i każde sztywne odejmowanie rozjeżdża się przy innej szerokości okna.
 */
function fitLogBox() {
  const el = $('logbox');
  if (!el.offsetParent) return;                  // zakładka niewidoczna
  const top = el.getBoundingClientRect().top;
  const h = Math.max(120, Math.floor(window.innerHeight - top - 16));
  el.style.height = `${h}px`;
}
window.addEventListener('resize', () => { fitLogBox(); updateLogFollow(); });

/**
 * Czy pole logu jest przewinięte na sam dół (z tolerancją na zaokrąglenia).
 * Od tego zależy, czy wolno je przewijać za nowymi wpisami.
 */
function logAtBottom() {
  const el = $('logbox');
  return el.scrollHeight - el.scrollTop - el.clientHeight < 24;
}

let lastLogHtml = '';

async function refreshLog() {
  const el = $('logbox');
  const entries = await window.bridge.log(200);
  const html = entries.map((e) => {
    const time = e.ts.slice(11, 19);
    const extra = e.extra ? ' ' + esc(e.extra) : '';
    return `<span class="lvl-${e.level}">${time} ${esc(e.msg)}${extra}</span>`;
  }).join('\n');

  // Nic się nie zmieniło — nie ruszamy DOM-u. Bez tego samo przerysowanie
  // co 2 s szarpało widokiem podczas czytania, choć log stał w miejscu.
  if (html !== lastLogHtml) {
    // Przewijamy za logiem TYLKO wtedy, gdy użytkownik jest na jego końcu.
    // Wcześniej skok na dół był bezwarunkowy, więc nie dało się nic przeczytać:
    // każde odświeżenie wyrywało widok z powrotem.
    const follow = logAtBottom();
    const keep = el.scrollTop;
    el.innerHTML = html;
    lastLogHtml = html;
    el.scrollTop = follow ? el.scrollHeight : keep;
  }
  fitLogBox();
  updateLogFollow();
}

/** Mówi wprost, czy widok nadąża za logiem — inaczej wygląda jak zawieszony. */
function updateLogFollow() {
  const bottom = logAtBottom();
  $('btnLogEnd').hidden = bottom;
  $('logFollow').textContent = bottom ? t('hint.logFollowing') : t('hint.logPaused');
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

/**
 * Pytanie „tak / anuluj" WŁASNYM okienkiem, zamiast natywnego `confirm`.
 *
 * Dlaczego nie natywne: w Electronie na Linuksie po zamknięciu blokującego
 * okienka renderer nie odzyskiwał ogniska klawiatury. Kliknięcia działały
 * dalej, ale w żadnym polu nie dało się nic wpisać — okno stawało się
 * bezużyteczne do końca sesji. Odtworzone 2026-09-04 na ścieżce:
 * dodaj cel bez uprawnień → Zapisz → Anuluj → dopisz cokolwiek.
 *
 * Ognisko wraca tam, gdzie było przed pytaniem, żeby po anulowaniu dało się
 * pisać dalej w tym samym polu.
 *
 * @returns {Promise<boolean>}
 */
function ask(text) {
  return new Promise((resolve) => {
    const box = $('ask');
    $('askText').textContent = text;
    $('askYes').textContent = t('btn.confirmYes');
    $('askNo').textContent = t('btn.confirmNo');
    const wczesniej = document.activeElement;

    const koniec = (odp) => {
      box.hidden = true;
      document.removeEventListener('keydown', naKlawisz, true);
      try { wczesniej?.focus?.(); } catch { /* element mógł zniknąć */ }
      resolve(odp);
    };
    // Tylko Escape przechwytujemy. Enter zostawiamy przyciskowi z ogniskiem —
    // inaczej „Anuluj" pod ogniskiem potwierdzałoby po naciśnięciu Enter.
    const naKlawisz = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); koniec(false); }
    };

    $('askYes').onclick = () => koniec(true);
    $('askNo').onclick = () => koniec(false);
    box.onclick = (e) => { if (e.target === box) koniec(false); };
    document.addEventListener('keydown', naKlawisz, true);
    box.hidden = false;
    // Ognisko na bezpieczniejszej odpowiedzi: Enter i Escape anulują.
    $('askNo').focus();
  });
}

// ---------- statystyki ----------

// Wybrany zakres. `null` = bez ograniczenia (wszystko, co jest w dzienniku).
let statsDni = null;
const ZAKRESY = [
  { dni: 1, klucz: 'range.today' },
  { dni: 7, klucz: 'range.week' },
  { dni: 30, klucz: 'range.month' },
  { dni: null, klucz: 'range.all' },
];

/** Data UTC sprzed n-1 dni, w postaci RRRR-MM-DD. */
function dataOd(dni) {
  if (!dni) return null;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - (dni - 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Jeden przekrój jako lista pasków.
 *
 * Pasek jest proporcjonalny do NAJWIĘKSZEJ wartości w tym przekroju, nie do
 * sumy — inaczej przy dwudziestu pozycjach wszystkie byłyby nierozróżnialnie
 * cienkie.
 */
function statsPanel(tytul, wiersze, { etykieta = (w) => w.key, limit = 12, ile = null } = {}) {
  if (!wiersze.length) return '';
  const max = Math.max(...wiersze.map((w) => w.copies), 1);
  const widoczne = wiersze.slice(0, limit);
  // „i ile więcej" liczymy z PRAWDZIWEJ liczby różnych wartości, a nie
  // z długości listy — ta bywa już przycięta po drodze. Napisane raz źle,
  // pokazywało „i 10 więcej" przy 237 pracowanych znakach.
  const reszta = (ile ?? wiersze.length) - widoczne.length;
  return `<div class="panel">
    <h2>${esc(tytul)}</h2>
    <div class="st-rows">${widoczne.map((w) => `
      <div class="st-row">
        <div class="st-bar" title="${esc(etykieta(w))}">
          <span class="fill" style="width:${Math.round((w.copies / max) * 100)}%"></span>
          <span class="lbl">${esc(etykieta(w))}</span>
        </div>
        <div class="st-num"><b>${w.qso}</b> ${t('stats.qsoShort')} · ${w.copies} ${t('stats.copiesShort')}</div>
      </div>`).join('')}</div>
    ${reszta > 0 ? `<div class="hint">${t('stats.more').replace('{n}', reszta)}</div>` : ''}
  </div>`;
}

function renderRangeButtons() {
  $('statsRange').innerHTML = ZAKRESY.map((z) => `
    <button class="act sec${statsDni === z.dni ? ' on' : ''}" data-dni="${z.dni ?? ''}">${t(z.klucz)}</button>`).join('');
  $('statsRange').querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      statsDni = b.dataset.dni === '' ? null : Number(b.dataset.dni);
      refreshStats();
    };
  });
}

async function refreshStats() {
  renderRangeButtons();
  let d = null;
  try { d = await window.bridge.stats?.(dataOd(statsDni), null); } catch { /* pokażemy brak */ }

  if (!d || !d.total || d.total.copies === 0) {
    $('statsTotal').className = 'empty';
    $('statsTotal').textContent = t('stats.empty');
    $('statsPanels').innerHTML = '';
    return;
  }

  const T = d.total;
  $('statsTotal').className = '';
  // Średnia liczona przez DNI Z ŁĄCZNOŚCIAMI, nie przez długość zakresu —
  // inaczej tydzień z jedną sobotą w eterze wyglądałby na katastrofę.
  const srednia = T.days ? Math.round(T.qso / T.days) : 0;
  $('statsTotal').innerHTML = `
    <div class="cards" style="margin:0">
      <div class="card" title="${esc(t('tip.statsQso'))}">
        <div class="k">${t('stats.qso')}</div><div class="v">${T.qso}</div>
        <div class="s">${t('stats.copies')}: ${T.copies}</div></div>
      <div class="card" title="${esc(t('tip.statsDays'))}">
        <div class="k">${t('stats.days')}</div><div class="v">${T.days}</div>
        <div class="s">${t('stats.perDayAvg').replace('{n}', srednia)}</div></div>
      <div class="card" title="${esc(t('tip.statsCalls'))}">
        <div class="k">${t('stats.calls')}</div><div class="v">${d.distinct?.calls ?? '—'}</div>
        <div class="s">${t('stats.stationsCount').replace('{n}', d.distinct?.stations ?? 0)}</div></div>
      <div class="card">
        <div class="k">${t('stats.first')}</div><div class="v" style="font-size:16px">${esc(T.first || '—')}</div>
        <div class="s">${t('stats.last')}: ${esc(T.last || '—')}</div></div>
    </div>`;

  const akcja = (w) => (w.name ? `#${w.key} ${w.name}` : `#${w.key}`);
  const ile = d.distinct || {};
  $('statsPanels').innerHTML = `<div class="st-grid">
    ${statsPanel(t('stats.perAction'), d.perAction, { etykieta: akcja, ile: ile.actions })}
    ${statsPanel(t('stats.perDay'), [...d.perDay].reverse(), { limit: 14, ile: ile.days })}
    ${statsPanel(t('stats.perOperator'), d.perOperator, { ile: ile.operators })}
    ${statsPanel(t('stats.perStation'), d.perStation, { ile: ile.stations })}
    ${statsPanel(t('stats.perBand'), d.perBand, { ile: ile.bands })}
    ${statsPanel(t('stats.perMode'), d.perMode, { ile: ile.modes })}
    ${statsPanel(t('stats.perSource'), d.perSource, { ile: ile.sources })}
    ${statsPanel(t('stats.topCalls'), d.topCalls, { limit: 10, ile: ile.calls })}
  </div>`;
}

// ---------- cele fan-outu ----------
function renderTargets(list) {
  $('targets').innerHTML = list.map((x) => {
    const on = x.enabled !== false;
    return `
    <div class="three${on ? '' : ' off'}" style="margin-bottom:8px" data-pinset="${x.pinSet ? '1' : '0'}">
      <div><label class="t-lbl">${t('label.targetOn')}</label>
        <input type="checkbox" class="t-on" style="width:auto" ${on ? 'checked' : ''}
               title="${esc(t('hint.targetOn'))}"></div>
      <div><label class="t-lbl">${t('label.stationCall')}</label><input type="text" class="t-station" value="${esc(x.station_callsign)}" placeholder="SN0ABC"></div>
      <div><label class="t-lbl">${t('label.operator')}</label><input type="text" class="t-op" value="${esc(x.operator || '')}" placeholder="SQ8BWM"></div>
      <div><label class="t-lbl">${t('label.targetPin')}</label><input type="text" class="t-pin" value="${esc(x.pin || '')}" placeholder="${esc(t('hint.targetPin'))}" title="${esc(t('hint.targetPinLong'))}"></div>
      <span class="t-chk"></span>
      <button class="act sec t-del">${t('btn.remove')}</button>
    </div>`;
  }).join('');
  $('targets').querySelectorAll('.t-station, .t-op').forEach(forceUpper);
  $('targets').querySelectorAll('.t-del').forEach((b) => {
    b.onclick = () => { b.closest('.three').remove(); };
  });
  // Wyszarzenie od razu po przełączeniu — widać, że reguła nie działa,
  // jeszcze przed zapisem.
  $('targets').querySelectorAll('.t-on').forEach((c) => {
    c.onchange = () => c.closest('.three').classList.toggle('off', !c.checked);
  });
  // Znaczniki wracają natychmiast, bez czekania na odświeżenie stanu.
  if (ostatniStatus) paintTargetChecks(ostatniStatus.forward?.targets);
}

/**
 * Znacznik uprawnień w wierszu reguły, po znaku stacji.
 *
 * Świadomie NIE odrysowujemy tu formularza: użytkownik może właśnie w nim
 * pisać, a podmiana pól gubiłaby wpisywany tekst i kursor.
 */
function paintTargetChecks(statusTargets) {
  const byStation = new Map(
    (statusTargets || []).map((x) => [String(x.station_callsign || '').toUpperCase(), x.check]),
  );
  for (const row of $('targets').querySelectorAll('.three')) {
    const el = row.querySelector('.t-chk');
    if (!el) continue;
    const station = row.querySelector('.t-station').value.trim().toUpperCase();
    const c = station ? byStation.get(station) : null;
    const wlaczona = row.querySelector('.t-on')?.checked !== false;

    // Brak oceny to NIE to samo co „w porządku": reguła może być dopiero
    // wpisywana albo serwis mógł nie odpowiedzieć. Wtedy nie pokazujemy nic.
    if (!c || c.state === 'unknown') {
      el.textContent = ''; el.title = ''; el.className = 't-chk';
      continue;
    }
    const kto = c.operator ? ` (${c.operator})` : '';
    if (c.state === 'ok') {
      el.textContent = '✓';
      el.className = 't-chk ok';
      el.title = t('chk.ok').replace('{konto}', kto.trim() || '—');
    } else if (c.state === 'no-active-action') {
      el.textContent = '•';
      el.className = 't-chk warn';
      el.title = t('chk.noActiveAction').replace('{konto}', kto.trim() || '—');
    } else {
      el.textContent = '!';
      el.className = 't-chk bad';
      const klucz = {
        'missing-station': 'chk.missingStation',
        'bad-pin': 'chk.badPin',
        'api-disabled': 'chk.apiDisabled',
        'no-pin': 'chk.noPin',
      }[c.state] || 'chk.missingStation';
      el.title = t(klucz).replace('{stacja}', station).replace('{konto}', kto.trim() || '—');
    }
    // Wyłączona reguła: treść i podpowiedź zostają, kolor schodzi na szary.
    if (!wlaczona && el.textContent) el.className = 't-chk muted';
  }
}

/** Panel „Konto na radiodyplom.pl" — czym konto naprawdę dysponuje. */
function renderAccount(s) {
  const box = $('accountInfo');
  const acc = s?.radiodyplom?.account;
  if (!acc) {
    box.className = 'empty';
    box.textContent = s?.radiodyplom?.pingOk === false ? t('account.offline') : t('account.unknown');
    return;
  }
  box.className = '';
  const wiersze = [];
  wiersze.push(`<div><b>${t('account.operator')}:</b> ${esc(s.radiodyplom.profile || '—')}</div>`);

  // `null` znaczy „serwis nie podał" (starsze API), `[]` — „konto nie ma ani
  // jednej stacji". Zlanie tych przypadków w jedno byłoby mylące.
  if (acc.stations === null) {
    wiersze.push(`<div><b>${t('account.stations')}:</b> <span class="hint">${t('account.notReported')}</span></div>`);
  } else if (acc.stations.length === 0) {
    wiersze.push(`<div class="lvl-warn"><b>${t('account.stations')}:</b> ${t('account.noStations')}</div>`);
  } else {
    wiersze.push(`<div><b>${t('account.stations')}:</b> ${acc.stations.map(esc).join(', ')}</div>`);
  }

  if (acc.activeActions === null) {
    wiersze.push(`<div><b>${t('account.actions')}:</b> <span class="hint">${t('account.notReported')}</span></div>`);
  } else if (acc.activeActions.length === 0) {
    wiersze.push(`<div class="lvl-warn"><b>${t('account.actions')}:</b> ${t('account.noActions')}</div>`);
  } else {
    const lista = acc.activeActions.map((a) => {
      const zakres = a.from && a.to ? ` <span class="hint">(${esc(String(a.from).slice(0, 10))} – ${esc(String(a.to).slice(0, 10))})</span>` : '';
      return `<div style="margin-left:12px">#${esc(String(a.id))} ${esc(a.name || '')}${zakres}</div>`;
    }).join('');
    wiersze.push(`<div><b>${t('account.actions')}:</b></div>${lista}`);
  }

  if (acc.pinExpires) wiersze.push(`<div><b>${t('account.pinExpires')}:</b> ${esc(String(acc.pinExpires))}</div>`);
  if (acc.apiEnabled === false) wiersze.push(`<div class="lvl-error"><b>${t('account.apiDisabled')}</b></div>`);
  box.innerHTML = wiersze.join('');
}

$('btnAddTarget').onclick = () => {
  const current = collectTargets({ validate: false });
  current.push({ station_callsign: '', operator: '', enabled: true });
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
      pin: row.querySelector('.t-pin').value.trim(),
      enabled: row.querySelector('.t-on').checked,
      // Tylko na potrzeby ostrzeżenia przy zapisie — rdzeń tego nie czyta.
      _pinWasSet: row.dataset.pinset === '1',
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
  const collected = collectTargets();
  if (collected === null) {
    // Zapis wstrzymany, a nie wykonany po cichu z pominięciem wiersza.
    $('saveInfo').textContent = t('hint.targetIncomplete');
    $('saveInfo').className = 'hint lvl-error';
    return;
  }

  // Puste pole PIN-u przy celu, który PIN miał, znaczy „usuń go". To decyzja
  // nieodwracalna z okna (sekretu nie da się odczytać z powrotem), więc pytamy.
  const zPinem = collected.filter((x) => x._pinWasSet && !x.pin).map((x) => x.station_callsign);
  if (zPinem.length) {
    const ok = await ask(t('confirm.dropTargetPin').replace('{stacje}', zPinem.join(', ')));
    if (!ok) return;
  }
  const targets = collected.map(({ _pinWasSet, ...x }) => x);

  // Sprawdzenie uprawnień PRZED zapisem, na tym, co jest w oknie.
  //
  // Świadomie BEZ blokady zapisu, z trzech powodów: dane bywają nieaktualne
  // o minutę (dokładnie tak było przy dopisywaniu SQ8BWA), serwis może nie
  // odpowiedzieć, a „wpiszę regułę teraz, stację dopiszę wieczorem" to
  // normalna kolejność pracy. Ostrzegamy i pytamy — decyduje użytkownik.
  if (window.bridge.checkConfig) {
    let zle = [];
    try {
      const w = await window.bridge.checkConfig({
        radiodyplom: { pin: $('fPin').value.trim() },
        forward: { targets },
      });
      zle = (w?.checks || []).filter((c) => c.enabled && c.blocking);
    } catch { /* brak odpowiedzi serwisu nie może wstrzymać zapisu */ }

    if (zle.length) {
      const opis = zle.map((c) => `${c.station}${c.operator ? ` (${c.operator})` : ''}`).join(', ');
      if (!await ask(t('confirm.targetsRejected').replace('{stacje}', opis))) return;
    }
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
$('btnRequeue').onclick = async () => {
  const s = await window.bridge.status();
  // PUŁAPKA: w trybie próbnym przywrócone QSO przejdą „na sucho" i zostaną
  // zamknięte w deduplikacji — czyli ponowienie po cichu je WYRZUCA, choć
  // klika się je właśnie po to, żeby je uratować. Pytamy wprost.
  if (s?.radiodyplom?.dryRun && (s.queue?.failed ?? 0) > 0) {
    if (!await ask(t('confirm.requeueDryRun'))) return;
  }
  // Bez tej informacji „nic się nie stało" było nieodróżnialne od zepsutego
  // przycisku — i realnie tak wyglądało.
  const n = await window.bridge.requeue();
  flashHint(n > 0 ? `${t('hint.requeued')} ${n}` : t('hint.requeuedNone'));
  refresh();
};
$('btnAckProblems').onclick = async () => {
  const n = await window.bridge.ackProblems();
  flashHint(`${t('hint.acked')} ${n}`);
  refresh();
};
$('btnDiscardFailed').onclick = async () => {
  // Trwałe usunięcie łączności – pytamy z podaniem liczby i bez owijania.
  const s = await window.bridge.status();
  const n = s?.queue?.failed ?? 0;
  if (!n) return;
  if (!await ask(t('confirm.discardFailed').replace('{n}', n))) return;
  const r = await window.bridge.discardFailed();
  flashHint(`${t('hint.discarded')} ${r.removed}`);
  refresh();
};
// Plakietka prowadzi tam, gdzie problemy widać i gdzie stoją wszystkie trzy
// przyciski: ponowienie, wyciszenie, usunięcie.
$('probBadge').onclick = () => {
  document.querySelector('nav button[data-tab="kolejka"]').click();
};
$('btnOpenLog').onclick = () => window.bridge.openLog();
$('btnLogEnd').onclick = () => {
  const el = $('logbox');
  el.scrollTop = el.scrollHeight;
  updateLogFollow();
};
$('logbox').addEventListener('scroll', updateLogFollow);

$('btnQuit').onclick = async () => {
  // Potwierdzenie, bo zamknięcie przerywa przekazywanie QSO.
  if (await ask(t('confirm.quit'))) await window.bridge.quit();
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
