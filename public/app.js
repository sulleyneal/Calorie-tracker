/* Morsel — front of house */
/* The client owns ALL personal data (browser localStorage). A server, when
   reachable, acts only as a stateless brain: Gemini parsing, USDA nutrition,
   nano banana photos. Nothing personal is ever stored server-side.
   Depends on engine globals: FOODS, findFood, parseLocally, titleCase,
   placeholderSvg (served as /engine.js, or inlined in the single-file build). */
const $ = (id) => document.getElementById(id);

const DB_KEY = 'morsel-v1';
const LEGACY_DB_KEY = 'morsel-demo-v1';

const state = {
  goal: 2000,
  entries: [],
  messages: [],
  busy: false,
  celebratedToday: false,
};

const API = {
  base: null, // set by detectApi()
  caps: { gemini: false, usda: false },
  key: null,
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const SUGGESTIONS = [
  'Had a cappuccino and an almond croissant',
  'Two eggs, bacon and toast',
  'Salmon poke bowl for lunch',
];

const GREETING = 'Hi, I\'m Morsel. Tell me what you eat the way you\'d text a friend — "had a latte and a bagel" is plenty. I\'ll keep the journal, the math, and the pictures. What have you had so far?';

const NO_FOOD_REPLIES = [
  'Hmm, I couldn\'t spot a food in that. Try something like "had a cappuccino and an almond croissant". ☕',
  'I didn\'t catch a food there — tell me something like "two eggs and toast" and I\'ll do the rest. 🍳',
];

/* ── tiny helpers ──────────────────────────────────────────────────── */
function nid() { return Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10); }
function todayKey() { return dateKeyOf(Date.now()); }
function dateKeyOf(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function dayLabel(key) {
  const diff = Math.round((keyToDate(todayKey()) - keyToDate(key)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const date = keyToDate(key);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}
function dayEyebrow(key) {
  const date = keyToDate(key);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`.toUpperCase();
}
function todayEntries() { return state.entries.filter((e) => e.dateKey === todayKey()); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function el(tag, cls, html) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html != null) node.innerHTML = html;
  return node;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function placeholderUri(name, emoji) {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(placeholderSvg(name, emoji || '🍽️'));
}

/* ── local journal store ───────────────────────────────────────────── */
function seedDb() {
  const now = Date.now();
  const y = now - 86400000; // a pre-seeded "Yesterday" so the journal has something to show
  const seedItems = [
    ['oatmeal with blueberries', 9], ['chicken shawarma wrap', 13],
    ['steamed rice', 13.05], ['greek yogurt', 16], ['strawberries', 16.05],
  ].map(([alias, hour]) => {
    const food = findFood(alias);
    const ts = new Date(new Date(y).setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0)).getTime();
    return {
      id: nid(), ts, dateKey: dateKeyOf(ts),
      name: titleCase(food.aliases[0]), emoji: food.emoji, portion: food.portion,
      image: placeholderUri(food.aliases[0], food.emoji),
      kcal: food.kcal, p: food.p, c: food.c, f: food.f, source: 'builtin',
    };
  });
  return {
    goal: 2000,
    entries: seedItems,
    messages: [{ id: nid(), role: 'bot', text: GREETING, ts: now }],
  };
}

function loadDb() {
  for (const key of [DB_KEY, LEGACY_DB_KEY]) {
    try {
      const db = JSON.parse(localStorage.getItem(key));
      if (db && Array.isArray(db.entries)) return db;
    } catch {}
  }
  return seedDb();
}

function saveDb() {
  const db = { goal: state.goal, entries: state.entries, messages: state.messages };
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(db));
      return;
    } catch {
      // Storage full — swap the oldest real photos for tiny illustrated
      // plates and try again.
      const heavy = db.entries
        .filter((e) => /^data:image\/(jpeg|png)/.test(e.image))
        .sort((a, b) => a.ts - b.ts)
        .slice(0, 5);
      if (!heavy.length) return;
      for (const e of heavy) e.image = placeholderUri(e.name, e.emoji);
    }
  }
}

/* ── server brain (optional) ───────────────────────────────────────── */
async function detectApi() {
  const params = new URLSearchParams(location.search);
  if (params.get('api')) {
    localStorage.setItem('morsel-api', params.get('api').replace(/\/$/, ''));
    if (params.get('key')) localStorage.setItem('morsel-key', params.get('key'));
    history.replaceState(null, '', location.pathname);
  }
  API.key = localStorage.getItem('morsel-key');

  const candidates = [];
  const saved = localStorage.getItem('morsel-api');
  if (saved) candidates.push(saved);
  if (location.protocol.startsWith('http')) candidates.push(''); // same origin (npm start)

  for (const base of candidates) {
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const health = await res.json();
      if (health.needsKey && !API.key) {
        const answer = prompt('This Morsel server is protected — enter its access code:');
        if (!answer) continue;
        API.key = answer.trim();
        localStorage.setItem('morsel-key', API.key);
      }
      API.base = base;
      API.caps = { gemini: !!health.gemini, usda: !!health.usda };
      return;
    } catch {}
  }
}

async function remoteAnalyze(text) {
  const totalToday = todayEntries().reduce((s, e) => s + e.kcal, 0);
  const res = await fetch(`${API.base}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(API.key ? { 'X-Morsel-Key': API.key } : {}) },
    body: JSON.stringify({ text, context: { goal: state.goal, totalToday } }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`analyze ${res.status}`);
  return res.json();
}

/* ── Morsel's voice (offline fallback) ─────────────────────────────── */
function fallbackReply(items, totalToday, goal) {
  const remaining = goal - totalToday;
  const names = items.map((i) => i.name).join(' and ');
  if (remaining > 400) return pick([
    `Logged the ${names.toLowerCase()} — you've got ${remaining.toLocaleString()} cal of runway left today. 🌤️`,
    `${names} — noted! Still ${remaining.toLocaleString()} cal to play with today.`,
  ]);
  if (remaining > 100) return pick([
    `Lovely — that leaves ${remaining.toLocaleString()} cal for the rest of the day.`,
    `Logged! You're cruising — ${remaining.toLocaleString()} cal left before your target.`,
  ]);
  if (remaining > -150) return pick([
    'That lands you right around your target for the day. 🎯',
    'Nicely done — that nudges you right up to your target.',
  ]);
  return pick([
    `That puts you ${Math.abs(remaining).toLocaleString()} over today — tomorrow's a fresh page. 🌱`,
    `A little over today (${Math.abs(remaining).toLocaleString()} cal) — happens to the best of us.`,
  ]);
}

/* ── the engine: log a meal ────────────────────────────────────────── */
async function logMeal({ text = '', confirm = false, skip = false, label }) {
  const now = Date.now();

  if (skip) {
    state.messages.push({ id: nid(), role: 'user', text: label || 'Same plate — skip it', ts: now });
    const reply = 'Got it — left it off the journal. 👌';
    state.messages.push({ id: nid(), role: 'bot', text: reply, ts: now });
    saveDb();
    return { reply, entries: [] };
  }

  const trimmed = String(text).trim().slice(0, 500);
  state.messages.push({ id: nid(), role: 'user', text: label || trimmed, ts: now });

  // 1. Parse + enrich: server brain when available, local engine otherwise.
  let items = [];
  let aiReply = null;
  if (API.base !== null) {
    try {
      const parsed = await remoteAnalyze(trimmed);
      items = parsed.items || [];
      aiReply = parsed.reply || null;
    } catch (err) {
      console.warn('server brain unavailable, falling back to local:', err.message);
    }
  }
  if (!items.length) {
    items = parseLocally(trimmed).map((item) => ({ ...item, image: null }));
    aiReply = null;
  }

  if (!items.length) {
    const reply = pick(NO_FOOD_REPLIES);
    state.messages.push({ id: nid(), role: 'bot', text: reply, ts: now });
    saveDb();
    return { reply, entries: [] };
  }

  // 2. The "same plate?" moment.
  if (!confirm) {
    const todayNames = new Set(todayEntries().map((e) => e.name.toLowerCase()));
    const dupes = items.filter((i) => todayNames.has(i.name.toLowerCase()));
    if (dupes.length) {
      const what = dupes.map((d) => d.name.toLowerCase()).join(' and ');
      const reply = `Looks like I already logged ${what.includes(' and ') ? 'those' : 'that'} ${what} a moment ago — want me to add a second helping, or was that the same plate?`;
      state.messages.push({ id: nid(), role: 'bot', text: reply, ts: now });
      saveDb();
      return { reply, entries: [], needsConfirm: true, originalText: trimmed };
    }
  }

  // 3. Commit to the journal (photos came from the server, or get a plate).
  const entries = items.map((item) => ({
    id: nid(), ts: now, dateKey: dateKeyOf(now),
    name: item.name, emoji: item.emoji || '🍽️', portion: item.portion || '1 serving',
    image: item.image || placeholderUri(item.name, item.emoji),
    kcal: Math.round(item.kcal || 0), p: Math.round(item.p || 0),
    c: Math.round(item.c || 0), f: Math.round(item.f || 0),
    source: item.source || 'builtin',
  }));
  state.entries.push(...entries);

  const totalToday = todayEntries().reduce((s, e) => s + e.kcal, 0);
  const reply = aiReply || fallbackReply(entries, totalToday, state.goal);
  state.messages.push({ id: nid(), role: 'bot', text: reply, ts: now, entryIds: entries.map((e) => e.id) });
  saveDb();
  return { reply, entries };
}

/* ── day summary ───────────────────────────────────────────────────── */
function animateNumber(node, to) {
  const from = Number(node.dataset.value || 0);
  if (from === to) { node.textContent = to.toLocaleString(); return; }
  node.dataset.value = to;
  const start = performance.now();
  const dur = 700;
  (function tick(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = Math.round(from + (to - from) * eased).toLocaleString();
    if (t < 1) requestAnimationFrame(tick);
  })(start);
}

function renderSummary() {
  const today = todayEntries();
  const total = today.reduce((s, e) => s + e.kcal, 0);
  $('todayEyebrow').textContent = dayEyebrow(todayKey());

  const totalNode = $('totalNum');
  const grew = total > Number(totalNode.dataset.value || 0);
  animateNumber(totalNode, total);
  if (grew) {
    totalNode.classList.remove('glow');
    void totalNode.offsetWidth; // restart the glow animation
    totalNode.classList.add('glow');
  }

  $('goalBtn').textContent = `${state.goal.toLocaleString()} cal`;
  const pct = Math.min(100, (total / state.goal) * 100);
  const fill = $('progressFill');
  fill.style.width = `${pct}%`;
  fill.classList.toggle('over', total > state.goal * 1.08);

  const p = today.reduce((s, e) => s + (e.p || 0), 0);
  const c = today.reduce((s, e) => s + (e.c || 0), 0);
  const f = today.reduce((s, e) => s + (e.f || 0), 0);
  $('mP').textContent = `${p}g`;
  $('mC').textContent = `${c}g`;
  $('mF').textContent = `${f}g`;
  // mini-bars show each macro's share of today's calories
  const macroCal = p * 4 + c * 4 + f * 9;
  $('bP').style.width = macroCal ? `${(p * 4 / macroCal) * 100}%` : '0%';
  $('bC').style.width = macroCal ? `${(c * 4 / macroCal) * 100}%` : '0%';
  $('bF').style.width = macroCal ? `${(f * 9 / macroCal) * 100}%` : '0%';
}

/* ── chat thread ───────────────────────────────────────────────────── */
function itemCard(entry) {
  return el('div', 'itemCard', `
    <img class="photo" src="${esc(entry.image)}" alt="${esc(entry.name)}" loading="lazy" />
    <div>
      <h3>${esc(entry.name)}</h3>
      <p class="portion">${esc(entry.portion)}</p>
      <p class="stats">
        <span class="kcal">${entry.kcal.toLocaleString()}<small> cal</small></span>
        <span class="macro p"><b>P</b> ${entry.p ?? 0}</span>
        <span class="macro c"><b>C</b> ${entry.c ?? 0}</span>
        <span class="macro f"><b>F</b> ${entry.f ?? 0}</span>
      </p>
    </div>`);
}

function appendMessage(msg) {
  const thread = $('thread');
  if (msg.role === 'user') {
    thread.appendChild(el('div', 'msg user', esc(msg.text)));
  } else {
    // item cards appear before Morsel's remark, like a receipt then a wink
    for (const id of msg.entryIds || []) {
      const entry = state.entries.find((e) => e.id === id);
      if (entry) thread.appendChild(itemCard(entry));
    }
    thread.appendChild(el('div', 'msg bot', esc(msg.text)));
  }
}

function renderThread() {
  const thread = $('thread');
  thread.innerHTML = '';
  for (const msg of state.messages) appendMessage(msg);
  renderSuggestions();
  scrollChat(false);
}

function renderSuggestions() {
  const box = $('suggestions');
  box.innerHTML = '';
  if (state.entries.length > 5 || state.messages.length > 1) return;
  for (const s of SUGGESTIONS) {
    const b = el('button', null, esc(s));
    b.onclick = () => { $('logInput').value = s; sendLog(); };
    box.appendChild(b);
  }
}

function scrollChat(smooth = true) {
  const view = $('chatView');
  view.scrollTo({ top: view.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

function showTyping() {
  const t = el('div', 'typing', '<i></i><i></i><i></i>');
  t.id = 'typingDots';
  $('thread').appendChild(t);
  scrollChat();
}
function hideTyping() {
  $('typingDots')?.remove();
}

function showConfirmChips(originalText) {
  const row = el('div', 'chipRow');
  row.id = 'confirmRow';
  const yes = el('button', null, 'Add it — second helping 🍽️');
  const no = el('button', null, 'Same plate — skip it');
  yes.onclick = () => { row.remove(); send({ text: originalText, confirm: true, label: 'Yes, add it!' }); };
  no.onclick = () => { row.remove(); send({ skip: true, label: 'Same plate — skip it' }); };
  row.append(yes, no);
  $('thread').appendChild(row);
  scrollChat();
}

/* ── journal view ──────────────────────────────────────────────────── */
function renderJournal() {
  const view = $('journalView');
  view.innerHTML = '';

  if (!state.entries.length) {
    view.appendChild(el('div', 'emptyJournal',
      `<div class="big">🍓</div>Your journal is empty.<br/>Tell Morsel what you ate and<br/>the pretty pictures will appear here.`));
    return;
  }

  const byDay = new Map();
  for (const entry of state.entries) {
    if (!byDay.has(entry.dateKey)) byDay.set(entry.dateKey, []);
    byDay.get(entry.dateKey).push(entry);
  }
  const days = [...byDay.keys()].sort().reverse();

  for (const key of days) {
    const entries = byDay.get(key);
    const total = entries.reduce((s, e) => s + e.kcal, 0);
    const block = el('section', 'dayBlock');
    block.appendChild(el('div', 'dayHead', `
      <div>
        <p class="eyebrow">${dayEyebrow(key)}</p>
        <h2 class="dayTitle">${dayLabel(key)}</h2>
      </div>
      <p class="dayTotal">${total.toLocaleString()}<small>cal</small></p>`));

    entries.forEach((entry, i) => {
      const row = el('article', 'jEntry' + (i % 2 ? ' flip' : ''));
      row.style.animationDelay = `${Math.min(i * 60, 360)}ms`;
      row.innerHTML = `
        <div class="photoWrap">
          <img class="photo" src="${esc(entry.image)}" alt="${esc(entry.name)}" loading="lazy" />
          <button class="del" title="Remove ${esc(entry.name)}">✕</button>
        </div>
        <div class="meta">
          <h3>${esc(entry.name)}</h3>
          <p class="portion">${esc(entry.portion)}</p>
          <p class="kcal">${entry.kcal.toLocaleString()}<small> cal</small></p>
        </div>`;
      row.querySelector('.del').onclick = () => deleteEntry(entry);
      block.appendChild(row);
    });
    view.appendChild(block);
  }
}

function deleteEntry(entry) {
  if (!window.confirm(`Remove ${entry.name} (${entry.kcal} cal) from your journal?`)) return;
  state.entries = state.entries.filter((e) => e.id !== entry.id);
  saveDb();
  renderJournal();
  renderSummary();
}

/* ── celebration ───────────────────────────────────────────────────── */
function celebrate() {
  const layer = $('burstLayer');
  const emojis = ['🍓', '✨', '🎉', '💪', '🌟'];
  for (let i = 0; i < 14; i++) {
    const b = el('span', 'burst', emojis[i % emojis.length]);
    b.style.left = `${8 + Math.random() * 84}%`;
    b.style.bottom = `${5 + Math.random() * 20}%`;
    b.style.setProperty('--spin', `${(Math.random() * 60 - 30).toFixed(0)}deg`);
    b.style.animationDelay = `${Math.random() * 0.45}s`;
    layer.appendChild(b);
    setTimeout(() => b.remove(), 2400);
  }
}

/* ── send flow ─────────────────────────────────────────────────────── */
async function send(payload) {
  state.busy = true;
  $('sendBtn').disabled = true;
  if (payload.label || payload.text) {
    appendMessage({ role: 'user', text: payload.label || payload.text });
    scrollChat();
  }
  showTyping();

  try {
    const wasUnderGoal = todayEntries().reduce((s, e) => s + e.kcal, 0) < state.goal;
    const data = await logMeal(payload);
    hideTyping();

    appendMessage({ role: 'bot', text: data.reply, entryIds: (data.entries || []).map((e) => e.id) });
    if (data.needsConfirm) showConfirmChips(data.originalText);

    renderSummary();
    renderJournal();
    renderSuggestions();
    scrollChat();

    const total = todayEntries().reduce((s, e) => s + e.kcal, 0);
    if (wasUnderGoal && total >= state.goal * 0.95 && total <= state.goal * 1.1 && !state.celebratedToday) {
      state.celebratedToday = true;
      celebrate();
    }
  } catch (err) {
    console.error(err);
    hideTyping();
    appendMessage({ role: 'bot', text: 'Something went sideways — try that again?' });
  } finally {
    state.busy = false;
    $('sendBtn').disabled = false;
    $('logInput').focus();
  }
}

function sendLog() {
  const input = $('logInput');
  const text = input.value.trim();
  if (!text || state.busy) return;
  input.value = '';
  navigator.vibrate?.(8);
  document.getElementById('confirmRow')?.remove();
  send({ text });
}

/* ── view switching ────────────────────────────────────────────────── */
function setView(view) {
  const chat = view === 'chat';
  const incoming = chat ? $('chatView') : $('journalView');
  $('chatView').hidden = !chat;
  $('journalView').hidden = chat;
  $('composer').style.display = chat ? '' : 'none';
  $('tabChat').setAttribute('aria-selected', chat);
  $('tabJournal').setAttribute('aria-selected', !chat);
  $('viewSwitch').classList.toggle('j', !chat);
  incoming.classList.remove('entering');
  void incoming.offsetWidth; // restart the entrance animation
  incoming.classList.add('entering');
  if (chat) scrollChat(false);
}

/* ── boot ──────────────────────────────────────────────────────────── */
async function init() {
  $('logForm').addEventListener('submit', (e) => { e.preventDefault(); sendLog(); });
  $('tabChat').onclick = () => setView('chat');
  $('tabJournal').onclick = () => setView('journal');
  $('goalBtn').onclick = () => {
    const answer = prompt('Daily calorie goal:', state.goal);
    const goal = Math.round(Number(answer));
    if (!answer || !Number.isFinite(goal) || goal < 500 || goal > 10000) return;
    state.goal = goal;
    saveDb();
    renderSummary();
  };

  const db = loadDb();
  state.goal = db.goal || 2000;
  state.entries = db.entries || [];
  state.messages = db.messages || [];
  saveDb(); // migrate legacy key forward
  state.celebratedToday = todayEntries().reduce((s, e) => s + e.kcal, 0) >= state.goal;

  renderSummary();
  renderThread();
  renderJournal();
  setView('chat');

  await detectApi(); // non-blocking for the UI; just upgrades the brain
}

init();
