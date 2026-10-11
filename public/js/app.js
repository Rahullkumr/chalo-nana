import { TEXT, CHIP_GROUPS } from './i18n.js';
import { initSpeech, stopSpeaking } from './speech.js';

const $ = (id) => document.getElementById(id);
const FELT = ['good', 'okay', 'tired', 'pain'];

let lang = localStorage.getItem('lang') || 'hi';
let state = null;
let settings = null;      // last settings from /api/settings (edited via the form)
let moodInfo = null;      // { mood, reasonHi, skipToday }
let plan = null;          // { route, speech, speechSource, warnings }
let walks = [];
let felt = 'good';
const picked = new Set();

const t = () => TEXT[lang];

async function api(path, body) {
  const res = await fetch(path, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

// ---------- language / theme ----------
function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  const dark = document.documentElement.dataset.theme === 'dark'
    || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  $('theme').textContent = dark ? t().toLight : t().toDark;
  $('theme').dataset.dark = dark;
}

function renderStatic() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t()[el.dataset.i18n]; });
  $('text').placeholder = t().textPh;
  document.querySelectorAll('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  renderChips();
  renderFeltChips();
  const sel = $('uphill');
  const cur = sel.value || 'no';
  sel.innerHTML = '';
  for (const [v, label] of Object.entries(t().uphillOpts)) sel.append(new Option(label, v));
  sel.value = cur;
  applyTheme();
  if (!speechBusy) $('listenLabel').textContent = t().listen;
  renderRoute();
  renderLog();
  if (plan) $('saved').hidden = true;
}

function chipButton(label, pressed, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pill';
  b.textContent = label;
  b.setAttribute('aria-pressed', String(pressed));
  b.addEventListener('click', onClick);
  return b;
}

function renderChips() {
  const box = $('chips');
  box.innerHTML = '';
  const places = (state?.places?.places || []).filter((p) => p.id !== 'home')
    .map((p) => [`${p.name} जाना है`, p.name]);
  const groups = CHIP_GROUPS.map(([key, items]) => [key, items.map(([hi, en]) => [hi, lang === 'hi' ? hi : en])]);
  if (places.length) groups.push(['gGo', places]);
  for (const [key, items] of groups) {
    const g = document.createElement('div');
    g.className = 'group';
    const l = document.createElement('p');
    l.className = 'group-label';
    l.textContent = t()[key];
    const row = document.createElement('div');
    row.className = 'chips';
    for (const [value, label] of items) {
      row.append(chipButton(label, picked.has(value), (e) => {
        if (picked.has(value)) picked.delete(value); else picked.add(value);
        e.currentTarget.setAttribute('aria-pressed', String(picked.has(value)));
      }));
    }
    g.append(l, row);
    box.append(g);
  }
}

function renderFeltChips() {
  const box = $('felt');
  box.innerHTML = '';
  for (const f of FELT) {
    box.append(chipButton(t().feltOpts[f], felt === f, () => { felt = f; renderFeltChips(); }));
  }
}

// ---------- waiting state ----------
let timer = null;
let waitEl = null;
function startWait(titleKey, el) {
  const t0 = Date.now();
  waitEl = el;
  const title = el.querySelector('.wt');
  title.innerHTML = '';
  const sp = document.createElement('span');
  sp.className = 'spinner';
  title.append(sp, document.createTextNode(t()[titleKey]));
  el.querySelector('.wtime').textContent = t().elapsed(0);
  el.hidden = false;
  clearInterval(timer);
  timer = setInterval(() => { el.querySelector('.wtime').textContent = t().elapsed(Math.round((Date.now() - t0) / 1000)); }, 1000);
}
function endWait() {
  clearInterval(timer);
  if (waitEl) waitEl.hidden = true;
}
function setBusy(busy) {
  $('make').disabled = busy;
  $('again').disabled = busy;
}
function showError(el, err) {
  el.textContent = err instanceof TypeError ? t().offline : t().fail;
  el.hidden = false;
}

// ---------- settings card ----------
function fillSettings() {
  $('maxMinutes').value = settings.maxMinutes;
  $('restEvery').value = settings.restEveryMinutes;
  $('uphill').value = settings.avoidUphill;
  $('shade').checked = Boolean(settings.preferShade);
}

function readSettings() {
  return {
    ...settings,
    maxMinutes: Number($('maxMinutes').value) || settings.maxMinutes,
    restEveryMinutes: Number($('restEvery').value) || settings.restEveryMinutes,
    avoidUphill: $('uphill').value,
    preferShade: $('shade').checked,
  };
}

function renderMood() {
  if (moodInfo) {
    $('moodLine').textContent = moodInfo.reasonHi || t().moods[moodInfo.mood] || moodInfo.mood;
    $('skip').hidden = !moodInfo.skipToday;
  } else if (plan) {
    $('moodLine').textContent = t().today;
    $('skip').hidden = true;
  }
}

function sumPill(text) {
  const s = document.createElement('span');
  s.className = 'sumpill';
  s.textContent = text;
  return s;
}

function renderPills(route) {
  const box = $('pills');
  box.innerHTML = '';
  if (!route?.ok || !settings) return;
  box.append(sumPill(t().pillWalk(route.walkMinutes, route.restMinutes)));
  box.append(sumPill(t().pillEvery(settings.restEveryMinutes)));
  box.append(sumPill(t().pillUphill(settings.avoidUphill)));
  if (settings.preferShade) box.append(sumPill(t().pillShade));
  box.append(sumPill(t().pillKm(route.estimatedKm)));
}

// ---------- route card ----------
function tag(text, cls = '') {
  const s = document.createElement('span');
  s.className = `tag ${cls}`.trim();
  s.textContent = text;
  return s;
}

function renderRoute() {
  if (!plan) return;
  const { route } = plan;
  $('planCard').hidden = false;
  renderMood();
  const ok = route && route.ok;
  $('noRoute').hidden = ok;
  $('fallback').hidden = !(ok && route.fallback);
  $('speechBox').hidden = !ok;
  renderPills(route);
  const tl = $('timeline');
  tl.innerHTML = '';
  $('source').textContent = '';
  $('warnBox').hidden = true;
  if (!ok) {
    if (route?.reason) { const li = document.createElement('li'); li.textContent = route.reason; tl.append(li); }
    return;
  }
  const add = (text, cls = '', tags = []) => {
    const li = document.createElement('li');
    if (cls) li.className = cls;
    li.append(document.createTextNode(text));
    if (tags.length) { li.append(document.createElement('br')); tags.forEach((x) => li.append(x)); }
    tl.append(li);
  };
  add(t().start);
  const stops = [...(route.stops || [])];
  const usedStops = new Set();
  const addStop = (s) => {
    // A stop without rest is a place he passes and looks at (the pandal), not a seat.
    if (!s.restMinutes) return add(t().passBy(s.name), '', []);
    const tags = typeof s.sit === 'string' && s.sit ? [tag(s.sit)] : [tag(t().tagSit)];
    add(t().sitAt(s.name, s.restMinutes), 'stop', tags);
  };
  (route.legs || []).forEach((leg) => {
    const tags = [];
    if (leg.shade) tags.push(tag(t().tagShade));
    if (leg.uphill) tags.push(tag(t().tagUphill, 'up'));
    add(t().walkTo(leg.toName, leg.minutes), '', tags);
    stops.forEach((s, i) => {
      if (!usedStops.has(i) && s.at === leg.to) { usedStops.add(i); addStop(s); }
    });
  });
  stops.forEach((s, i) => { if (!usedStops.has(i)) addStop(s); });
  add(t().home);
  const warns = plan.warnings || [];
  $('warnBox').hidden = warns.length === 0;
  $('warnings').innerHTML = '';
  warns.forEach((w) => { const li = document.createElement('li'); li.textContent = w; $('warnings').append(li); });
  $('source').textContent = { gemma: t().srcGemma, template: t().srcTemplate }[plan.speechSource] || '';
}

// ---------- actions ----------
async function runPlan() {
  startWait('wait2', $('wait2'));
  try {
    plan = await api('/api/plan', { settings });
    $('speech').value = plan.speech || '';
    $('saved').hidden = true;
    renderRoute();
    $('planCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } finally {
    endWait();
  }
}

async function onMake() {
  const text = $('text').value.trim();
  if (!picked.size && !text) {
    $('err').textContent = t().needInput;
    $('err').hidden = false;
    return;
  }
  $('err').hidden = true;
  setBusy(true);
  stopSpeaking();
  startWait('wait1', $('wait'));
  try {
    const res = await api('/api/settings', { chips: [...picked], text });
    settings = res.settings;
    moodInfo = { mood: res.mood, reasonHi: res.reasonHi, skipToday: res.skipToday };
    fillSettings();
    await runPlan();
  } catch (err) {
    showError($('err'), err);
  } finally {
    endWait();
    setBusy(false);
  }
}

async function onAgain() {
  if (!settings) return;
  settings = readSettings();
  $('err2').hidden = true;
  setBusy(true);
  stopSpeaking();
  try {
    await runPlan();
  } catch (err) {
    showError($('err2'), err);
  } finally {
    setBusy(false);
  }
}

async function onSave() {
  const btn = $('save');
  btn.disabled = true;
  const msg = $('saved');
  msg.className = 'msg';
  msg.textContent = t().saving;
  msg.hidden = false;
  try {
    const res = await api('/api/today', { settings, route: plan.route, speech: $('speech').value });
    msg.textContent = `${t().saved}. ${res.audio ? t().audioYes : t().audioNo}`;
  } catch (err) {
    msg.className = 'msg error';
    msg.textContent = err instanceof TypeError ? t().offline : t().fail;
  } finally {
    btn.disabled = false;
  }
}

async function onLogWalk() {
  $('logged').hidden = true;
  $('logErr').hidden = true;
  $('logBtn').disabled = true;
  try {
    const res = await api('/api/walks', {
      steps: Number($('steps').value) || 0,
      minutes: Number($('minutes').value) || 0,
      rests: Number($('rests').value) || 0,
      felt,
      completed: $('completed').checked,
      note: $('note').value.trim(),
    });
    walks = res.walks || walks;
    if (state && res.week) state.week = res.week;
    renderLog();
    $('logged').hidden = false;
    ['steps', 'minutes', 'rests', 'note'].forEach((id) => { $(id).value = ''; });
  } catch (err) {
    showError($('logErr'), err);
  } finally {
    $('logBtn').disabled = false;
  }
}

function renderGoal() {
  const w = state?.week;
  $('goalLine').hidden = !w?.goal;
  if (w?.goal) $('goalLine').textContent = t().goalLine(w);
}

function renderLog() {
  renderGoal();
  const body = $('logBody');
  body.innerHTML = '';
  const rows = [...walks].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  $('logTable').hidden = rows.length === 0;
  $('noWalks').hidden = rows.length > 0;
  for (const w of rows) {
    const tr = document.createElement('tr');
    [w.date, w.steps, w.km, w.minutes, w.rests, t().feltOpts[w.felt] || w.felt].forEach((v) => {
      const td = document.createElement('td');
      td.textContent = v ?? '';
      tr.append(td);
    });
    body.append(tr);
  }
}

// ---------- init ----------
let speechBusy = false;
async function init() {
  document.querySelectorAll('.lang button').forEach((b) => b.addEventListener('click', () => {
    lang = b.dataset.lang;
    localStorage.setItem('lang', lang);
    renderStatic();
  }));
  $('theme').addEventListener('click', () => {
    const next = $('theme').dataset.dark === 'true' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    applyTheme(next);
  });
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;

  $('make').addEventListener('click', onMake);
  $('again').addEventListener('click', onAgain);
  $('save').addEventListener('click', onSave);
  $('logBtn').addEventListener('click', onLogWalk);
  initSpeech({
    button: $('listen'),
    label: $('listenLabel'),
    getText: () => $('speech').value,
    getLang: () => lang,
    onNote: (msg) => { $('voiceNote').textContent = msg; $('voiceNote').hidden = !msg; },
  });
  renderStatic();

  try {
    state = await api('/api/state');
  } catch {
    $('err').textContent = t().offline;
    $('err').hidden = false;
    return;
  }
  $('example').hidden = !state.example;
  walks = state.walks || [];
  renderChips();
  renderLog();
  const today = state.today;
  if (today && today.route) {
    settings = today.settings;
    moodInfo = null;
    plan = { route: today.route, speech: today.speech, speechSource: '', warnings: [] };
    $('speech').value = today.speech || '';
    if (settings) fillSettings();
    renderRoute();
  }
}

init();
