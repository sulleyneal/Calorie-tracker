/* Morsel — front of house */
/* The client owns ALL personal data (browser localStorage). A server, when
   reachable, acts only as a stateless brain: Gemini parsing, USDA nutrition,
   nano banana photos. Nothing personal is ever stored server-side.
   Depends on engine globals: FOODS, findFood, parseLocally, titleCase,
   placeholderSvg (served as /engine.js, or inlined in the single-file build). */
const $ = (id) => document.getElementById(id);

const BUILD = 'b18-close'; // bump on each deploy so we can confirm freshness
const DB_KEY = 'morsel-v1';
const LEGACY_DB_KEY = 'morsel-demo-v1';

const state = {
  goal: 2000,
  entries: [],
  messages: [],
  profile: null, // saved calculator inputs
  busy: false,
  celebratedToday: false,
};

const API = {
  base: null, // set by detectApi()
  caps: { gemini: false, usda: false },
  key: null,
};

// The default brain server (override any time with ?api=https://...).
const DEFAULT_API = 'https://morsel-brain.onrender.com';

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
  const db = { goal: state.goal, entries: state.entries, messages: state.messages, profile: state.profile };
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
async function tryBrain(base, timeoutMs) {
  const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`health ${res.status}`);
  const health = await res.json();
  if (health.needsKey && !API.key) {
    const answer = prompt('This Morsel server is protected — enter its access code:');
    if (!answer) throw new Error('no access code');
    API.key = answer.trim();
    localStorage.setItem('morsel-key', API.key);
  }
  API.base = base;
  API.caps = {
    gemini: !!health.gemini,
    smartParse: health.smartParse ?? !!health.gemini,
    usda: !!health.usda,
  };
}

// Shows a Morsel remark in the thread without saving it to the journal.
function announce(text) {
  const thread = $('thread');
  if (!thread) return;
  thread.appendChild(el('div', 'msg bot', esc(text)));
  scrollChat();
}

function brainConnectedNote() {
  if (API.caps.gemini) return 'Brain connected — smart parsing, live USDA nutrition, and nano banana photos are on. 🍌';
  if (API.caps.smartParse) return 'Brain connected — smart parsing and live USDA nutrition are on (free). Food images stay as illustrated plates. 🍓';
  return 'Brain connected — but it has no AI key, so I\'ll use my built-in food list. Add a free GROQ_API_KEY on the server for smart parsing.';
}

function celebrateConnection() {
  announce(brainConnectedNote());
  localStorage.setItem('morsel-connected', '1');
}

// Free-tier servers sleep; keep knocking in the background until one wakes.
function retryBrainLoop(bases, attempt = 0) {
  if (API.base !== null || attempt >= 10) return;
  setTimeout(async () => {
    for (const base of bases) {
      try {
        await tryBrain(base, 20000);
        celebrateConnection();
        return;
      } catch {}
    }
    retryBrainLoop(bases, attempt + 1);
  }, attempt === 0 ? 5000 : 30000);
}

async function detectApi() {
  const params = new URLSearchParams(location.search);
  const explicit = Boolean(params.get('api'));
  if (explicit) {
    let url = params.get('api').trim().replace(/\/$/, '');
    if (!/^https?:\/\//.test(url)) url = `https://${url}`;
    localStorage.setItem('morsel-api', url);
    if (params.get('key')) localStorage.setItem('morsel-key', params.get('key'));
    history.replaceState(null, '', location.pathname);
  }
  API.key = localStorage.getItem('morsel-key');

  // Same origin first when the page is served by its own brain (npm start).
  if (location.protocol.startsWith('http') && !location.host.endsWith('github.io')) {
    try { await tryBrain('', 4000); return; } catch {}
  }

  const saved = localStorage.getItem('morsel-api');
  const candidates = [...new Set([saved, DEFAULT_API].filter(Boolean))];
  if (!candidates.length) return;

  for (const base of candidates) {
    try {
      // Generous timeout: free-tier servers cold-start in 30-60s.
      await tryBrain(base, explicit && base === saved ? 75000 : 25000);
      // A saved address that failed while the default worked is stale — drop it.
      if (saved && base !== saved) localStorage.removeItem('morsel-api');
      if (explicit || !localStorage.getItem('morsel-connected')) celebrateConnection();
      else localStorage.setItem('morsel-connected', '1');
      return;
    } catch {}
  }

  if (explicit) {
    let host = saved || DEFAULT_API;
    try { host = new URL(host).host; } catch {}
    announce(`I saved your brain server (${host}) but couldn't reach it yet — free servers can take a minute to wake up. I'll keep trying quietly; photos kick in once it answers.`);
  }
  retryBrainLoop(candidates);
}

// The brain to use for a log: the confirmed one, or the configured candidate
// (so a cold-starting server still gets used instead of falling to local).
function brainBase() {
  if (API.base !== null) return API.base;
  if (location.protocol.startsWith('http') && !location.host.endsWith('github.io')) return null;
  return localStorage.getItem('morsel-api') || DEFAULT_API;
}

async function remoteAnalyze(base, text) {
  const totalToday = todayEntries().reduce((s, e) => s + e.kcal, 0);
  let res;
  try {
    res = await fetch(`${base}/api/analyze`, {
      method: 'POST',
      // text/plain + no custom headers = a "simple" CORS request (no preflight).
      // The access code rides in the body instead of an X- header.
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ text, key: API.key || undefined, context: { goal: state.goal, totalToday } }),
      signal: AbortSignal.timeout(90000), // long: free servers cold-start in 30-60s
    });
  } catch (err) {
    // fetch() rejects (TypeError/timeout) when the server can't be reached.
    throw new Error("couldn't reach the brain server — it may be waking up (free servers nap after ~15 min idle). Try again in ~30s.");
  }
  if (!res.ok) throw new Error(`the brain server returned an error (${res.status})`);
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

  // 1. Parse + enrich. Route through the configured brain even if the initial
  //    health check hasn't confirmed it yet — this wakes a sleeping free
  //    server and uses real AI for the very first log, not just later ones.
  let items = [];
  let aiReply = null;
  let warnings = [];
  let brainErrored = false; // brain reached but Gemini hiccuped, OR unreachable
  const base = brainBase();
  if (base !== null) {
    try {
      const parsed = await remoteAnalyze(base, trimmed);
      items = parsed.items || [];
      aiReply = parsed.reply || null;
      warnings = parsed.warnings || [];
      if (warnings.length) brainErrored = true;
      if (API.base === null) { API.base = base; } // confirmed live — use it from now on
    } catch (err) {
      console.warn('server brain unavailable, falling back to local:', err.message);
      brainErrored = true;
      warnings = [err.message];
    }
  }
  if (!items.length) {
    items = parseLocally(trimmed).map((item) => ({ ...item, image: null }));
    aiReply = null;
  }

  if (!items.length) {
    // Nothing matched. If the brain choked, the food was probably real —
    // say so and offer a retry, rather than implying the text had no food.
    const reply = brainErrored
      ? 'The AI brain is a bit overloaded right now, so I fell back to my basic word-list and didn\'t recognize that one. Give it another tap in a few seconds? 🌀'
      : pick(NO_FOOD_REPLIES);
    state.messages.push({ id: nid(), role: 'bot', text: reply, ts: now });
    saveDb();
    return { reply, entries: [], warnings, brainErrored };
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
    id: nid(), ts: now, dateKey: dateKeyOf(now), meal: mealForTime(now).key,
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
  return { reply, entries, warnings };
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

  // Sticky mini-summary mirrors the same numbers.
  $('sbNum').textContent = total.toLocaleString();
  $('sbGoalNum').textContent = state.goal.toLocaleString();
  $('sbP').textContent = `${p}g`;
  $('sbC').textContent = `${c}g`;
  $('sbF').textContent = `${f}g`;
  const sbFill = $('sbFill');
  sbFill.style.width = `${pct}%`;
  sbFill.classList.toggle('over', total > state.goal * 1.08);

  // "Clear today" only when there's something to clear.
  $('clearDayBtn').hidden = today.length === 0;
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

/* ── meal of day ───────────────────────────────────────────────────── */
// Buckets a timestamp into a meal by the hour it was logged.
const MEALS = [
  { key: 'breakfast', label: 'Breakfast', emoji: '🌅', from: 4, to: 11 },
  { key: 'lunch', label: 'Lunch', emoji: '☀️', from: 11, to: 16 },
  { key: 'dinner', label: 'Dinner', emoji: '🌙', from: 16, to: 22 },
  { key: 'snack', label: 'Late Snack', emoji: '🌃', from: 22, to: 4 },
];
function mealForTime(ts) {
  const h = new Date(ts).getHours();
  return MEALS.find((m) => m.from < m.to ? (h >= m.from && h < m.to) : (h >= m.from || h < m.to)) || MEALS[3];
}
function mealOf(entry) {
  return MEALS.find((m) => m.key === entry.meal) || mealForTime(entry.ts);
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
    const head = el('div', 'dayHead', `
      <div>
        <p class="eyebrow">${dayEyebrow(key)}</p>
        <h2 class="dayTitle">${dayLabel(key)}</h2>
      </div>
      <div class="dayRight">
        <p class="dayTotal">${total.toLocaleString()}<small>cal</small></p>
        <button class="clearDay">Clear day</button>
      </div>`);
    head.querySelector('.clearDay').onclick = () => clearDay(key);
    block.appendChild(head);

    // Group the day's entries into meals, in chronological meal order.
    let rowIdx = 0;
    for (const meal of MEALS) {
      const mealEntries = entries.filter((e) => mealOf(e).key === meal.key);
      if (!mealEntries.length) continue;
      const mealCal = mealEntries.reduce((s, e) => s + e.kcal, 0);
      const group = el('div', 'mealGroup');
      group.appendChild(el('div', 'mealHead',
        `<span class="mealName">${meal.emoji} ${meal.label}</span><span class="mealRule"></span><span class="mealCal">${mealCal.toLocaleString()} cal</span>`));

      mealEntries.forEach((entry) => {
        const row = el('article', 'jEntry' + (rowIdx++ % 2 ? ' flip' : ''));
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
        group.appendChild(row);
      });
      block.appendChild(group);
    }
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

// Wipe every entry from a single day (with confirmation).
function clearDay(dateKey) {
  const dayEntries = state.entries.filter((e) => e.dateKey === dateKey);
  if (!dayEntries.length) return;
  const cal = dayEntries.reduce((s, e) => s + e.kcal, 0);
  const when = dayLabel(dateKey).toLowerCase();
  if (!window.confirm(`Clear all ${dayEntries.length} item${dayEntries.length > 1 ? 's' : ''} from ${when} (${cal.toLocaleString()} cal)? This can't be undone.`)) return;
  state.entries = state.entries.filter((e) => e.dateKey !== dateKey);
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
  // If a log is taking a while, it's almost certainly a sleeping free server
  // waking up — reassure rather than look frozen.
  let wokeNote;
  const wakeTimer = setTimeout(() => {
    if (!state.wokeOnce) {
      state.wokeOnce = true;
      wokeNote = el('div', 'msg bot', '☕ Waking up the kitchen — the first order after a quiet spell can take up to a minute…');
      wokeNote.id = 'wokeNote';
      $('thread').appendChild(wokeNote);
      scrollChat();
    }
  }, 6000);

  try {
    const wasUnderGoal = todayEntries().reduce((s, e) => s + e.kcal, 0) < state.goal;
    const data = await logMeal(payload);
    clearTimeout(wakeTimer);
    document.getElementById('wokeNote')?.remove();
    hideTyping();

    appendMessage({ role: 'bot', text: data.reply, entryIds: (data.entries || []).map((e) => e.id) });
    if (data.needsConfirm) showConfirmChips(data.originalText);
    // Surface a brain warning, but only when it's a new/changed issue.
    const w = data.warnings?.length ? String(data.warnings[0]) : null;
    if (w && w !== state.lastWarning) {
      state.lastWarning = w;
      const note = /503|high demand|UNAVAILABLE/i.test(w)
        ? 'Google\'s free Gemini tier is busy right now (503). It usually clears in a few minutes — adding a free GROQ_API_KEY on the server gives it a reliable backup.'
        : /429|quota/i.test(w)
          ? 'That\'s a Gemini quota limit (429). Smart parsing is free with a GROQ_API_KEY; only the photos need billing.'
          : `⚠️ ${w}`;
      announce(note.startsWith('⚠️') ? note : `⚠️ ${note}`);
    } else if (!w) {
      state.lastWarning = null; // brain healthy again
    }

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
    clearTimeout(wakeTimer);
    document.getElementById('wokeNote')?.remove();
    hideTyping();
    appendMessage({ role: 'bot', text: 'Something went sideways — try that again?' });
  } finally {
    clearTimeout(wakeTimer);
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
  if (!chat) $('stickyBar').classList.remove('show'); // bar is chat-only
  incoming.classList.remove('entering');
  void incoming.offsetWidth; // restart the entrance animation
  incoming.classList.add('entering');
  if (chat) scrollChat(false);
}

// Reveal the sticky mini-summary once the full summary scrolls out of view.
function watchStickyBar() {
  const summary = $('daySummary');
  const bar = $('stickyBar');
  if (!('IntersectionObserver' in window)) return;
  new IntersectionObserver(([entry]) => {
    const onChat = !$('chatView').hidden;
    bar.classList.toggle('show', onChat && !entry.isIntersecting);
  }, { root: $('chatView'), threshold: 0, rootMargin: '-8px 0px 0px 0px' }).observe(summary);
}

/* ── goal sheet + calculator ───────────────────────────────────────── */
// Mifflin-St Jeor BMR → activity multiplier (TDEE) → goal adjustment.
function computeTarget(p) {
  if (!p) return null;
  const age = Number(p.age);
  let weightKg, heightCm;
  if (p.units === 'metric') {
    weightKg = Number(p.weight);
    heightCm = Number(p.cm);
  } else {
    weightKg = Number(p.weight) * 0.453592;
    heightCm = (Number(p.ft || 0) * 12 + Number(p.in || 0)) * 2.54;
  }
  if (!age || age < 13 || age > 100 || !weightKg || weightKg < 25 || !heightCm || heightCm < 120) return null;

  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + (p.sex === 'male' ? 5 : -161);
  const tdee = bmr * Number(p.activity || 1.55);
  // ~3,500 cal per pound → ~500 cal/day per lb-per-week.
  const rate = Number(p.rate || 1);
  const adj = p.dir === 'lose' ? -rate * 500 : p.dir === 'gain' ? rate * 500 : 0;
  const maintenance = Math.round(tdee / 10) * 10;
  const floor = p.sex === 'male' ? 1500 : 1200;
  const target = Math.max(floor, Math.round((tdee + adj) / 10) * 10);
  return { target, maintenance, dir: p.dir, rate, floored: target > tdee + adj + 5 };
}

function rateWords(rate) {
  return rate === 0.5 ? '½ lb (0.2 kg)' : rate === 1.5 ? '1½ lb (0.7 kg)' : '1 lb (0.45 kg)';
}
function targetNote(r) {
  if (!r) return null;
  const m = `${r.maintenance.toLocaleString()} cal`;
  if (r.dir === 'lose') return `Maintenance is about ${m}. This targets roughly ${rateWords(r.rate)} of loss a week.` + (r.floored ? ' Kept at a safe minimum — for faster loss, add activity rather than eating less.' : '');
  if (r.dir === 'gain') return `Maintenance is about ${m}. This supports a gain of about ${rateWords(r.rate)} a week.`;
  return `About ${m} keeps your weight steady at your current activity level.`;
}

const SEEN = {};
function getSeg(id) { return $(id).querySelector('.on')?.dataset.v || null; }
function setSeg(id, v) {
  for (const b of $(id).querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === v);
}
function wireSeg(id, onChange) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    setSeg(id, b.dataset.v);
    onChange?.();
  });
}

function readProfileForm() {
  return {
    sex: getSeg('gSex') || 'female',
    age: $('gAge').value,
    units: getSeg('gUnits') || 'imperial',
    ft: $('gFt').value, in: $('gIn').value, cm: $('gCm').value,
    weight: $('gWeight').value,
    activity: $('gActivity').value,
    dir: getSeg('gDir') || 'maintain',
    rate: getSeg('gRate') || '1',
  };
}

function applyUnitToggle() {
  const metric = getSeg('gUnits') === 'metric';
  $('fieldHeightImp').hidden = metric;
  $('fieldHeightMet').hidden = !metric;
  $('gWeightU').textContent = metric ? 'kg' : 'lb';
}

// Show the pace picker only for lose/gain, and label it accordingly.
function applyDirToggle() {
  const dir = getSeg('gDir');
  $('fieldRate').hidden = !(dir === 'lose' || dir === 'gain');
  $('rateLabel').textContent = dir === 'gain' ? 'Gain pace' : 'Loss pace';
}

// The fields the calculator needs; returns the id of the first empty one.
function firstMissingField() {
  if (!$('gAge').value) return 'gAge';
  if (getSeg('gUnits') === 'metric') { if (!$('gCm').value) return 'gCm'; }
  else if (!$('gFt').value) return 'gFt';
  if (!$('gWeight').value) return 'gWeight';
  return null;
}

let recResult = null;
function recompute() {
  const p = readProfileForm();
  state.profile = p;
  saveDb();
  recResult = computeTarget(p);
  $('gNote').classList.remove('warn');
  if (recResult) {
    $('gRec').textContent = recResult.target.toLocaleString();
    $('gNote').textContent = targetNote(recResult);
  } else {
    $('gRec').textContent = '—';
    $('gNote').textContent = 'Add your age, height, and weight and I\'ll suggest a target.';
  }
}

function openGoalSheet() {
  const p = state.profile || { sex: 'female', units: 'imperial', activity: '1.55', dir: 'maintain', rate: '1' };
  setSeg('gSex', p.sex || 'female');
  setSeg('gUnits', p.units || 'imperial');
  setSeg('gDir', p.dir || 'maintain');
  setSeg('gRate', p.rate || '1');
  $('gAge').value = p.age || '';
  $('gFt').value = p.ft || ''; $('gIn').value = p.in || ''; $('gCm').value = p.cm || '';
  $('gWeight').value = p.weight || '';
  $('gActivity').value = p.activity || '1.55';
  $('gManual').value = state.goal;
  applyUnitToggle();
  applyDirToggle();
  recompute();
  $('goalSheet').hidden = false;
}
function closeGoalSheet() { $('goalSheet').hidden = true; }

function setGoal(goal) {
  goal = Math.round(Number(goal));
  if (!Number.isFinite(goal) || goal < 500 || goal > 10000) {
    alert('Pick a goal between 500 and 10,000 calories.');
    return false;
  }
  state.goal = goal;
  saveDb();
  renderSummary();
  return true;
}

function wireGoalSheet() {
  wireSeg('gSex', recompute);
  wireSeg('gDir', () => { applyDirToggle(); recompute(); });
  wireSeg('gRate', recompute);
  wireSeg('gUnits', () => { applyUnitToggle(); recompute(); });
  for (const id of ['gAge', 'gFt', 'gIn', 'gCm', 'gWeight']) $(id).addEventListener('input', recompute);
  $('gActivity').addEventListener('change', recompute);

  // Instant visible feedback proves the tap registered; any error is surfaced
  // rather than failing silently.
  function flash(btn) {
    const old = btn.textContent;
    btn.textContent = 'Saving…';
    setTimeout(() => { btn.textContent = old; }, 600);
  }
  $('gUseRec').onclick = () => {
    flash($('gUseRec'));
    try {
      recompute(); // re-read the form in case an input event was missed
      if (!recResult) {
        const miss = firstMissingField();
        $('gNote').textContent = 'Add your age, height, and weight first so I can calculate a target.';
        $('gNote').classList.add('warn');
        if (miss) $(miss).focus();
        return;
      }
      if (setGoal(recResult.target)) {
        closeGoalSheet();
        announce(`Goal set to ${recResult.target.toLocaleString()} cal a day. ${recResult.dir === 'lose' ? 'Let\'s do this. 💪' : recResult.dir === 'gain' ? 'Let\'s build. 💪' : 'Steady as she goes. 🌿'}`);
      }
    } catch (err) {
      alert('Couldn\'t set the goal: ' + (err && err.message));
    }
  };
  $('gUseManual').onclick = () => {
    flash($('gUseManual'));
    try {
      if (setGoal($('gManual').value)) {
        closeGoalSheet();
        announce(`Goal set to ${state.goal.toLocaleString()} cal a day. 🎯`);
      }
    } catch (err) {
      alert('Couldn\'t set the goal: ' + (err && err.message));
    }
  };
  $('gClose').onclick = closeGoalSheet;
  $('goalSheet').querySelector('.sheetBackdrop').onclick = closeGoalSheet;
}

/* ── boot ──────────────────────────────────────────────────────────── */
async function init() {
  $('logForm').addEventListener('submit', (e) => { e.preventDefault(); sendLog(); });
  $('tabChat').onclick = () => setView('chat');
  $('tabJournal').onclick = () => setView('journal');
  $('goalBtn').onclick = openGoalSheet;
  $('clearDayBtn').onclick = () => clearDay(todayKey());
  wireGoalSheet();
  $('buildStamp').textContent = `Morsel · build ${BUILD}`;
  console.log(`Morsel build ${BUILD}`);

  const db = loadDb();
  state.goal = db.goal || 2000;
  state.entries = db.entries || [];
  state.messages = db.messages || [];
  state.profile = db.profile || null;
  saveDb(); // migrate legacy key forward
  state.celebratedToday = todayEntries().reduce((s, e) => s + e.kcal, 0) >= state.goal;

  renderSummary();
  renderThread();
  renderJournal();
  setView('chat');
  watchStickyBar();

  await detectApi(); // non-blocking for the UI; just upgrades the brain
}

init();
