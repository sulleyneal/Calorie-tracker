/* Morsel — front of house */
/* The client owns ALL personal data (browser localStorage). A server, when
   reachable, acts only as a stateless brain: meal parsing and USDA nutrition.
   Nothing personal is ever stored server-side.
   Depends on engine globals: FOODS, findFood, parseLocally, titleCase,
   placeholderSvg (served as /engine.js, or inlined in the single-file build). */
const $ = (id) => document.getElementById(id);

const BUILD = 'b39-no-drops'; // bump on each deploy so we can confirm freshness
const DB_KEY = 'morsel-v1';
const LEGACY_DB_KEY = 'morsel-demo-v1';

const state = {
  goal: 2000,
  entries: [],
  messages: [],
  profile: null, // saved calculator inputs
  flags: {}, // one-time moments already shown (e.g. the goal nudge)
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
function dayMap() {
  const byDay = new Map();
  for (const e of state.entries) {
    const d = byDay.get(e.dateKey) || { kcal: 0, p: 0, c: 0, f: 0, count: 0 };
    d.kcal += e.kcal; d.p += e.p || 0; d.c += e.c || 0; d.f += e.f || 0; d.count++;
    byDay.set(e.dateKey, d);
  }
  return byDay;
}
// Consecutive logged days ending today — or yesterday, so a not-yet-logged
// morning never reads as a broken streak.
function currentStreak(byDay = dayMap()) {
  let streak = 0;
  const cursor = new Date(keyToDate(todayKey()));
  if (!byDay.has(todayKey())) cursor.setDate(cursor.getDate() - 1);
  while (byDay.has(dateKeyOf(cursor.getTime()))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
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
// A brand-new journal starts truly empty — every number Morsel ever shows
// is something the user actually logged. (No demo seed data: in a tracker,
// trust in the numbers IS the product.)
function seedDb() {
  return {
    goal: 2000,
    entries: [],
    messages: [{ id: nid(), role: 'bot', text: GREETING, ts: Date.now() }],
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
  // Chat scrollback is a conversation, not the record — the journal (entries)
  // is never trimmed. Keeping the last ~200 messages stops unbounded growth.
  if (state.messages.length > 240) state.messages = state.messages.slice(-200);
  const db = { goal: state.goal, entries: state.entries, messages: state.messages, profile: state.profile, flags: state.flags };

  // Real photos are the storage hogs. Retire the oldest to illustrated
  // plates — proactively before localStorage's ~5 MB wall, and again if the
  // browser still refuses the write.
  const retireOldestPhotos = (n) => {
    const heavy = db.entries
      .filter((e) => /^data:image\/(jpeg|png|webp)/.test(e.image))
      .sort((a, b) => a.ts - b.ts)
      .slice(0, n);
    for (const e of heavy) e.image = placeholderUri(e.name, e.emoji);
    return heavy.length;
  };

  let json = JSON.stringify(db);
  while (json.length > 4200000 && retireOldestPhotos(6)) json = JSON.stringify(db);
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      localStorage.setItem(DB_KEY, json);
      return;
    } catch {
      if (!retireOldestPhotos(6)) return;
      json = JSON.stringify(db);
    }
  }
}

/* ── server brain (optional) ───────────────────────────────────────── */
async function tryBrain(base, timeoutMs) {
  const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`health ${res.status}`);
  const health = await res.json();
  if (health.needsKey && !API.key) {
    // No native prompt(): explain the one-time link format instead.
    announce(`That brain server is protected. Open the app once as ?api=${base}&key=YOUR-ACCESS-CODE and I'll remember the code on this device.`);
    throw new Error('needs access code');
  }
  API.base = base;
  API.caps = {
    gemini: !!health.gemini,
    smartParse: health.smartParse ?? !!health.gemini,
    photo: health.photo ?? (health.smartParse ?? !!health.gemini),
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
  if (API.caps.smartParse) return 'Brain connected — smart parsing and live USDA nutrition are on. 🍓';
  return 'Brain connected — using my built-in food list. Add a free GROQ_API_KEY on the server for smarter parsing.';
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

// Photo analysis rides the same brain. The payload is bigger (a compressed
// JPEG), so this only runs against a configured server — no local fallback.
async function remoteAnalyzePhoto(base, photo, note) {
  const totalToday = todayEntries().reduce((s, e) => s + e.kcal, 0);
  const localTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  let res;
  try {
    res = await fetch(`${base}/api/photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' }, // keeps the request preflight-free
      body: JSON.stringify({
        image: photo.image, mediaType: photo.mediaType, note: note || undefined,
        key: API.key || undefined,
        context: { goal: state.goal, totalToday, localTime },
      }),
      signal: AbortSignal.timeout(90000),
    });
  } catch (err) {
    throw new Error("couldn't reach the brain server — it may be waking up (free servers nap after ~15 min idle). Try again in ~30s.");
  }
  if (!res.ok) {
    let msg = `the brain server returned an error (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
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
async function logMeal({ text = '', skip = false, label, photo = null, repeat = null, confirmItems = null }) {
  const now = Date.now();

  if (skip) {
    state.messages.push({ id: nid(), role: 'user', text: label || 'Same plate — skip it', ts: now });
    const reply = 'Got it — left it off the journal. 👌';
    state.messages.push({ id: nid(), role: 'bot', text: reply, ts: now });
    saveDb();
    return { reply, entries: [] };
  }

  // ── repeat path: one tap re-logs a usual — instant, local, no network ──
  if (repeat) {
    const u = repeat;
    state.messages.push({ id: nid(), role: 'user', text: label || `${u.name} — the usual`, ts: now });
    const entry = {
      id: nid(), ts: now, dateKey: dateKeyOf(now), meal: mealForTime(now).key,
      name: u.name, emoji: u.emoji || '🍽️', portion: u.portion || '1 serving',
      // A previous real photo belongs to that plate, not this one.
      image: /^data:image\/svg/.test(u.image || '') ? u.image : placeholderUri(u.name, u.emoji),
      kcal: u.kcal || 0, p: u.p || 0, c: u.c || 0, f: u.f || 0,
      source: 'repeat',
    };
    state.entries.push(entry);
    const totalToday = todayEntries().reduce((s, e) => s + e.kcal, 0);
    const reply = fallbackReply([entry], totalToday, state.goal);
    state.messages.push({ id: nid(), role: 'bot', text: reply, ts: now, entryIds: [entry.id] });
    saveDb();
    return { reply, entries: [entry] };
  }

  // ── "second helping" path: commit the plate we already parsed and showed —
  // never re-parse, or the duplicate could come back as a different meal. ──
  if (confirmItems) {
    state.messages.push({ id: nid(), role: 'user', text: label || 'Add it — second helping', ts: now });
    const mealKey = mealForTime(now).key;
    const entries = confirmItems.map((item) => ({
      id: nid(), ts: now, dateKey: dateKeyOf(now), meal: mealKey,
      name: item.name, emoji: item.emoji || '🍽️', portion: item.portion || '1 serving',
      image: item.image || placeholderUri(item.name, item.emoji),
      kcal: Math.round(item.kcal || 0), p: Math.round(item.p || 0),
      c: Math.round(item.c || 0), f: Math.round(item.f || 0),
      source: item.source || 'builtin',
    }));
    state.entries.push(...entries);
    const totalToday = todayEntries().reduce((s, e) => s + e.kcal, 0);
    const reply = fallbackReply(entries, totalToday, state.goal);
    state.messages.push({ id: nid(), role: 'bot', text: reply, ts: now, entryIds: entries.map((e) => e.id) });
    saveDb();
    return { reply, entries };
  }

  // ── photo path: brain-only, the user's own photo becomes the journal shot ──
  if (photo) {
    const note = String(text).trim().slice(0, 300);
    state.messages.push({ id: nid(), role: 'user', text: label || (note ? `📷 ${note}` : '📷 Snapped a plate'), ts: now });

    if (navigator.onLine === false) {
      const reply = 'Reading photos needs a connection, and we\'re offline right now. Tell me what\'s on the plate in words and I\'ll log it — I work offline too. 💬';
      state.messages.push({ id: nid(), role: 'bot', text: reply, ts: now });
      saveDb();
      return { reply, entries: [] };
    }

    const base = brainBase();
    if (base === null) {
      const reply = 'Photo logging needs the brain server, and I don\'t have one configured here. Open the app once with ?api=https://your-brain — or just tell me what\'s on the plate in words. 💬';
      state.messages.push({ id: nid(), role: 'bot', text: reply, ts: now });
      saveDb();
      return { reply, entries: [] };
    }

    let parsed;
    try {
      parsed = await remoteAnalyzePhoto(base, photo, note);
      if (API.base === null) API.base = base;
    } catch (err) {
      const reply = `I couldn't read that photo — ${err.message}`;
      state.messages.push({ id: nid(), role: 'bot', text: reply, ts: now });
      saveDb();
      return { reply, entries: [], warnings: [err.message], brainErrored: true };
    }

    const items = parsed.items || [];
    if (!items.length) {
      // Whatever the model chose to say, the user must know nothing landed
      // in the journal — a cheery reply alone reads as "logged".
      let reply = parsed.reply || 'I couldn\'t make out the food in that photo — try more light, or tell me in words. 📷';
      if (!/log|journal|couldn'?t|didn'?t/i.test(reply)) {
        reply += ' Nothing went into the journal from this one — tell me in words and I\'ll log it. 📷';
      }
      state.messages.push({ id: nid(), role: 'bot', text: reply, ts: now });
      saveDb();
      return { reply, entries: [], warnings: parsed.warnings || [] };
    }

    const photoMeal = mealFromText(note) || mealForTime(now).key;
    const entries = items.map((item, i) => ({
      id: nid(), ts: now, dateKey: dateKeyOf(now), meal: photoMeal,
      name: item.name, emoji: item.emoji || '🍽️', portion: item.portion || '1 serving',
      // The first item wears the user's actual photo; extra items from the
      // same plate get illustrated plates so the shot isn't repeated.
      image: item.image || (i === 0 ? photo.thumb : placeholderUri(item.name, item.emoji)),
      kcal: Math.round(item.kcal || 0), p: Math.round(item.p || 0),
      c: Math.round(item.c || 0), f: Math.round(item.f || 0),
      source: item.source || 'photo',
    }));
    state.entries.push(...entries);

    const totalToday = todayEntries().reduce((s, e) => s + e.kcal, 0);
    const reply = parsed.reply || fallbackReply(entries, totalToday, state.goal);
    state.messages.push({ id: nid(), role: 'bot', text: reply, ts: now, entryIds: entries.map((e) => e.id) });
    saveDb();
    return { reply, entries, warnings: parsed.warnings || [] };
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
  // Offline is a first-class mode, not an error: skip the brain quietly and
  // let the built-in parser do its thing.
  const offline = navigator.onLine === false;
  const base = offline ? null : brainBase();
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
  let usedLocal = false;
  if (!items.length) {
    items = parseLocally(trimmed).map((item) => ({ ...item, image: null }));
    aiReply = null;
    usedLocal = true;
  }

  if (!items.length) {
    // Nothing matched. If the brain choked, the food was probably real —
    // say so and offer a retry, rather than implying the text had no food.
    const reply = offline
      ? 'We\'re offline, so I\'m working from my built-in food list and didn\'t recognize that one. Try simpler words ("chicken and rice") — the smart brain comes back with the connection. 📡'
      : brainErrored
        ? 'The AI brain is a bit overloaded right now, so I fell back to my basic word-list and didn\'t recognize that one. Give it another tap in a few seconds? 🌀'
        : pick(NO_FOOD_REPLIES);
    state.messages.push({ id: nid(), role: 'bot', text: reply, ts: now });
    saveDb();
    return { reply, entries: [], warnings, brainErrored };
  }

  // 2. Corrections: "actually the toast was 2 slices" edits the recent entry
  //    instead of double-logging it. Only treated as a correction when every
  //    parsed food maps onto something logged in the last 45 minutes. Matching
  //    is on shared food words, not full-name containment, so "large coffee"
  //    still finds a "Coffee With Milk" entry.
  // A correction is signalled by a keyword ("actually…", "oops…") OR by the
  // restate shape "that/the <food> was <size|number>", which otherwise would
  // log a phantom 0-cal entry.
  const looksLikeCorrection = /^\s*(actually|correction|oops|wait)\b|^\s*no[,.\s]/i.test(trimmed)
    || /\b(?:that|the)\s+[a-z][a-z\s]{1,30}?\s+(?:was|were|should\s+be)\s+(?:a\s+|an\s+)?(?:\d|extra\s*large|venti|large|big|grande|regular|medium|tall|small|half|double)\b/i.test(trimmed);
  if (looksLikeCorrection) {
    const cutoff = now - 45 * 60000;
    // A bare size word ("...was a large") resizes the original entry so its
    // composition survives — re-parsing "large coffee" would drop the milk.
    // A restated quantity ("was 2 slices") or calorie count replaces instead.
    const sizeM = /\b(extra\s*large|venti|large|big|grande|regular|medium|tall|small)\b/i.exec(trimmed);
    const restated = /\b\d+(\.\d+)?\s*(k?cals?|calories?|slices?|cups?|pieces?|eggs?|scoops?|bars?|links?|servings?|bowls?)\b/i.test(trimmed);
    const sizeFactor = { 'extra large': 1.7, venti: 1.6, large: 1.4, big: 1.4, grande: 1, regular: 1, medium: 1, tall: 0.85, small: 0.72 };
    const fixed = [];
    for (const item of items) {
      const iwords = foodWords(item.name);
      const target = [...state.entries].reverse().find((e) => e.ts >= cutoff && !fixed.includes(e)
        && foodWords(e.name).some((w) => iwords.includes(w)));
      if (!target) { fixed.length = 0; break; }
      if (sizeM && !restated) {
        // Resize from the entry's own baseline; keep its name and makeup.
        const base = target.base || { kcal: target.kcal, p: target.p, c: target.c, f: target.f };
        const k = sizeFactor[sizeM[1].toLowerCase().replace(/\s+/g, ' ')] || 1;
        target.base = base;
        target.kcal = Math.round(base.kcal * k);
        target.p = Math.round(base.p * k);
        target.c = Math.round(base.c * k);
        target.f = Math.round(base.f * k);
        target.portion = `${sizeM[1].toLowerCase()}${/\bcoffee|latte|drink|tea|soda|juice|smoothie|shake\b/i.test(target.name) ? '' : ' portion'}`;
      } else {
        target.portion = item.portion || target.portion;
        target.kcal = Math.round(item.kcal || 0);
        target.p = Math.round(item.p || 0);
        target.c = Math.round(item.c || 0);
        target.f = Math.round(item.f || 0);
        delete target.base;
      }
      fixed.push(target);
    }
    if (fixed.length) {
      const reply = `Fixed — ${fixed.map((e) => `${e.name.toLowerCase()} is now ${e.portion}, ${e.kcal.toLocaleString()} cal`).join('; ')}. ✍️`;
      state.messages.push({ id: nid(), role: 'bot', text: reply, ts: now, entryIds: fixed.map((e) => e.id) });
      saveDb();
      return { reply, entries: fixed };
    }
  }

  // 3. The "same plate?" moment. The pending items are clones of the plates
  //    already in the journal, so a confirmed second helping is identical to
  //    the first — numbers, labels, everything.
  {
    const todayNames = new Set(todayEntries().map((e) => e.name.toLowerCase()));
    const dupes = items.filter((i) => todayNames.has(i.name.toLowerCase()));
    if (dupes.length) {
      const pending = items.map((i) => {
        const match = [...todayEntries()].reverse().find((e) => e.name.toLowerCase() === i.name.toLowerCase());
        if (!match) return i;
        return {
          name: match.name, emoji: match.emoji, portion: match.portion,
          kcal: match.kcal, p: match.p, c: match.c, f: match.f,
          image: /^data:image\/svg/.test(match.image || '') ? match.image : null,
          source: match.source,
        };
      });
      const what = dupes.map((d) => d.name.toLowerCase()).join(' and ');
      const reply = `Looks like I already logged ${what.includes(' and ') ? 'those' : 'that'} ${what} a moment ago — want me to add a second helping, or was that the same plate?`;
      state.messages.push({ id: nid(), role: 'bot', text: reply, ts: now });
      saveDb();
      return { reply, entries: [], needsConfirm: true, pendingItems: pending };
    }
  }

  // 3. Commit to the journal (photos came from the server, or get a plate).
  const textMeal = mealFromText(trimmed) || mealForTime(now).key;
  const entries = items.map((item) => ({
    id: nid(), ts: now, dateKey: dateKeyOf(now), meal: textMeal,
    name: item.name, emoji: item.emoji || '🍽️', portion: item.portion || '1 serving',
    image: item.image || placeholderUri(item.name, item.emoji),
    kcal: Math.round(item.kcal || 0), p: Math.round(item.p || 0),
    c: Math.round(item.c || 0), f: Math.round(item.f || 0),
    source: item.source || 'builtin',
  }));
  state.entries.push(...entries);

  const totalToday = todayEntries().reduce((s, e) => s + e.kcal, 0);
  let reply = aiReply || fallbackReply(entries, totalToday, state.goal);
  // Local word-list parsing can only log foods it knows — if the sentence
  // clearly named more foods than we logged, say so instead of undercounting
  // in silence.
  if (usedLocal && entries.length) {
    const segments = trimmed.split(/,|\band\b/i).filter((s) => /[a-z]/i.test(s)).length;
    if (segments > entries.length) {
      reply += ' (I\'m on my small built-in food list right now and may have missed part of that — tell me the rest and I\'ll add it.)';
    }
  }
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

  // The streak lives on the front page from day 2 — a celebration, not a leash.
  const streak = currentStreak();
  const streakChip = $('streakChip');
  streakChip.hidden = streak < 2;
  if (streak >= 2) {
    streakChip.textContent = `🔥 ${streak}-day streak`;
    streakChip.title = `You've logged ${streak} days in a row`;
  }

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
// A stored image that fails to load (old journal, pruned data) falls back to
// the entry's illustrated plate instead of a broken-image glyph.
function wireImageFallback(img, entry) {
  const fallback = () => {
    img.onerror = null;
    img.src = placeholderUri(entry.name, entry.emoji);
  };
  img.onerror = fallback;
  // The error may already have fired before this handler attached.
  if (img.complete && img.naturalWidth === 0) fallback();
}

function itemCard(entry) {
  const card = el('div', 'itemCard', `
    <img class="photo" src="${esc(entry.image)}" alt="${esc(entry.name)}" />
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
  wireImageFallback(card.querySelector('img'), entry);
  // The natural gesture when a card looks wrong is to tap it — same editor
  // as the journal row.
  card.title = `Adjust or remove ${entry.name}`;
  card.onclick = () => {
    const live = state.entries.find((e) => e.id === entry.id);
    if (live) openEntryEditor(live);
    else showToast('That one isn\'t in the journal any more.', { ttl: 3000 });
  };
  return card;
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
  // The chat shows the recent conversation; the full record lives in Journal.
  for (const msg of state.messages.slice(-40)) appendMessage(msg);
  renderSuggestions();
  // A brand-new journal stays at the top: the first thing a new user sees is
  // the whole Today card, not a half-clipped hero number.
  if (state.messages.length > 1) scrollChat(false);
  else $('chatView').scrollTop = 0;
}

// Rebuild the thread in place after an entry edit/removal so its cards can't
// contradict the journal — no scroll jump, no replayed entrance animations.
function refreshThreadCards() {
  const view = $('chatView');
  const keep = view.scrollTop;
  const thread = $('thread');
  thread.classList.add('still');
  thread.innerHTML = '';
  for (const msg of state.messages.slice(-40)) appendMessage(msg);
  view.scrollTop = keep;
  setTimeout(() => thread.classList.remove('still'), 60);
}

// The foods you actually repeat (last 30 days, logged 2+ times), minus what's
// already on today's page — the 100th log should be faster than the 1st.
function computeUsuals() {
  const cutoff = Date.now() - 30 * 86400000;
  const todayNames = new Set(todayEntries().map((e) => e.name.toLowerCase()));
  const byName = new Map();
  for (const e of state.entries) {
    if (e.ts < cutoff) continue;
    const k = e.name.toLowerCase();
    const u = byName.get(k) || { count: 0, latest: null };
    u.count++;
    if (!u.latest || e.ts > u.latest.ts) u.latest = e;
    byName.set(k, u);
  }
  return [...byName.values()]
    .filter((u) => u.count >= 2 && !todayNames.has(u.latest.name.toLowerCase()))
    .sort((a, b) => b.count - a.count || b.latest.ts - a.latest.ts)
    .slice(0, 3)
    .map((u) => u.latest);
}

function renderSuggestions() {
  const box = $('suggestions');
  box.innerHTML = '';
  // Brand-new journal: example phrasings to copy.
  if (state.entries.length === 0 && state.messages.length <= 1) {
    for (const s of SUGGESTIONS) {
      const b = el('button', null, esc(s));
      b.onclick = () => { $('logInput').value = s; sendLog(); };
      box.appendChild(b);
    }
    return;
  }
  // Returning: your usuals, one tap to log again.
  for (const u of computeUsuals()) {
    const b = el('button', 'usual', `${esc(u.emoji)} ${esc(u.name)}<span class="uCal">${u.kcal.toLocaleString()} cal</span>`);
    b.onclick = () => { if (!state.busy) send({ repeat: u, label: `${u.name} — the usual ${u.emoji}` }); };
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

// One-time, after the very first log: the default 2,000 goal is a guess —
// invite the user to make it theirs. Chips are DOM-only (not journal history).
function showGoalNudge() {
  state.flags.goalNudge = true;
  saveDb();
  announce('One quick thing — I\'m measuring against a starter goal of 2,000 cal. Want me to tailor it to you? Takes about 20 seconds.');
  const row = el('div', 'chipRow');
  row.id = 'goalNudgeRow';
  const yes = el('button', null, 'Set my goal 🎯');
  const no = el('button', null, '2,000 works for now');
  yes.onclick = () => { row.remove(); openGoalSheet(); };
  no.onclick = () => { row.remove(); announce('Easy — 2,000 it is. You can tap the goal number up top any time to change it.'); };
  row.append(yes, no);
  $('thread').appendChild(row);
  scrollChat();
}

function showConfirmChips(pendingItems) {
  const row = el('div', 'chipRow');
  row.id = 'confirmRow';
  const yes = el('button', null, 'Add it — second helping 🍽️');
  const no = el('button', null, 'Same plate — skip it');
  // The transcript echoes exactly what was tapped, and the confirmed plate is
  // the one already parsed — committed as-is, no second trip to the brain.
  yes.onclick = () => { row.remove(); send({ confirmItems: pendingItems, label: 'Add it — second helping 🍽️' }); };
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
// "turkey sandwich for lunch" files under Lunch no matter what the clock
// says — the user's words outrank the hour.
function mealFromText(text) {
  const m = /\b(breakfast|brunch|lunch|dinner|supper|snack)\b/i.exec(text || '');
  if (!m) return null;
  const word = m[1].toLowerCase();
  if (word === 'brunch') return 'breakfast';
  if (word === 'supper') return 'dinner';
  return word;
}
function mealOf(entry) {
  return MEALS.find((m) => m.key === entry.meal) || mealForTime(entry.ts);
}

// The identifying food words in a name — size words, brands and connectives
// stripped — so a correction can match "large coffee" to "Coffee With Milk".
const FOOD_STOPWORDS = new Set(['with', 'and', 'the', 'a', 'an', 'of', 'plus', 'in',
  'large', 'small', 'medium', 'big', 'regular', 'extra', 'grande', 'venti', 'tall',
  'half', 'whole', 'side', 'order', 'cup', 'glass', 'bowl', 'plate', 'slice', 'slices',
  'starbucks', 'mcdonalds', 'my', 'some']);
function foodWords(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length >= 3 && !FOOD_STOPWORDS.has(w));
}

/* ── journal view ──────────────────────────────────────────────────── */
let journalDaysShown = 14; // older days load on request, keeping day-60 renders light
function renderJournal() {
  const view = $('journalView');
  const keepScroll = view.scrollTop; // an edit deep in the list must not lose the reader's place
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
  const allDays = [...byDay.keys()].sort().reverse();
  const days = allDays.slice(0, journalDaysShown);

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
            <img class="photo" src="${esc(entry.image)}" alt="${esc(entry.name)}" />
            <button class="del" title="Remove ${esc(entry.name)}">✕</button>
          </div>
          <div class="meta">
            <h3>${esc(entry.name)}</h3>
            <p class="portion">${esc(entry.portion)}</p>
            <p class="kcal">${entry.kcal.toLocaleString()}<small> cal</small></p>
          </div>`;
        row.querySelector('.del').onclick = () => deleteEntry(entry);
        row.querySelector('.meta').onclick = () => openEntryEditor(entry);
        row.querySelector('.meta').title = `Adjust or remove ${entry.name}`;
        wireImageFallback(row.querySelector('img'), entry);
        group.appendChild(row);
      });
      block.appendChild(group);
    }
    view.appendChild(block);
  }

  if (allDays.length > days.length) {
    const more = el('button', 'ghostBtn moreDays', `Show earlier days (${allDays.length - days.length} more)`);
    more.onclick = () => { journalDaysShown += 30; renderJournal(); };
    view.appendChild(more);
  }

  view.scrollTop = keepScroll;
}

// Render only what's on screen; hidden views re-render on next visit.
// At day 60 a full journal render is real work — don't pay it per log.
const dirty = { journal: false, trends: false };
function rerenderAll() {
  renderSummary();
  renderSuggestions();
  if (!$('journalView').hidden) renderJournal(); else dirty.journal = true;
  if (!$('trendsView').hidden) renderTrends(); else dirty.trends = true;
}

/* ── toast: gentle feedback + undo instead of scary confirms ───────── */
let toastTimer = null;
function showToast(text, { actionLabel, onAction, ttl = 6000 } = {}) {
  const toast = $('toast');
  clearTimeout(toastTimer);
  toast.innerHTML = '';
  toast.appendChild(el('span', 'toastText', esc(text)));
  if (actionLabel) {
    const b = el('button', 'toastAction', esc(actionLabel));
    b.onclick = () => { hideToast(); onAction?.(); };
    toast.appendChild(b);
  }
  toast.hidden = false;
  void toast.offsetWidth; // reflow so the transition runs — works even in throttled tabs
  toast.classList.add('show');
  toastTimer = setTimeout(hideToast, ttl);
  // A pointer heading for Undo must never watch the toast vanish mid-click
  // and hit whatever sits underneath — hovering pauses the clock.
  toast.onpointerenter = () => clearTimeout(toastTimer);
  toast.onpointerleave = () => { clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, 1800); };
  toast.onfocusin = () => clearTimeout(toastTimer);
  toast.onfocusout = () => { clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, 1800); };
}
function hideToast() {
  const toast = $('toast');
  clearTimeout(toastTimer);
  toast.classList.remove('show');
  setTimeout(() => { toast.hidden = true; }, 350);
}

// Removal is instant and undoable — no "are you sure", just "here's the way back".
function removeEntries(entries, what) {
  const ids = new Set(entries.map((e) => e.id));
  state.entries = state.entries.filter((e) => !ids.has(e.id));
  saveDb();
  rerenderAll();
  refreshThreadCards();
  showToast(what, {
    actionLabel: 'Undo',
    onAction: () => {
      state.entries.push(...entries);
      state.entries.sort((a, b) => a.ts - b.ts);
      saveDb();
      rerenderAll();
      refreshThreadCards();
    },
    ttl: 7000,
  });
}

function deleteEntry(entry) {
  removeEntries([entry], `Removed ${entry.name} (${entry.kcal.toLocaleString()} cal)`);
}

function clearDay(dateKey) {
  const dayEntries = state.entries.filter((e) => e.dateKey === dateKey);
  if (!dayEntries.length) return;
  const cal = dayEntries.reduce((s, e) => s + e.kcal, 0);
  removeEntries(dayEntries, `Cleared ${dayLabel(dateKey)} — ${dayEntries.length} item${dayEntries.length > 1 ? 's' : ''}, ${cal.toLocaleString()} cal`);
}

/* ── entry editor: fix a portion in two taps ───────────────────────── */
function fmtMult(m) {
  return { 0.5: '½', 0.75: '¾', 1.5: '1½', 2: '2' }[m] || `×${String(+m.toFixed(2))}`;
}

function closeEntryEditor() {
  document.getElementById('entrySheet')?.remove();
}

function openEntryEditor(entry) {
  closeEntryEditor();
  // First edit stashes the original numbers, so adjustments never compound.
  const base = entry.base || { kcal: entry.kcal, p: entry.p, c: entry.c, f: entry.f, portion: entry.portion };
  const wrap = el('div', 'miniSheetWrap');
  wrap.id = 'entrySheet';
  const card = el('div', 'sheetCard miniSheet');
  card.innerHTML = `
    <div class="sheetHandle"></div>
    <h2 class="sheetTitle miniTitle">${esc(entry.name)}</h2>
    <p class="sheetSub">${esc(entry.portion)} · ${entry.kcal.toLocaleString()} cal. Ate more or less than that? Fix it here.</p>
    <div class="scaleRow">
      <button class="scaleBtn" data-m="0.5">½×</button>
      <button class="scaleBtn" data-m="0.75">¾×</button>
      <button class="scaleBtn" data-m="1.5">1½×</button>
      <button class="scaleBtn" data-m="2">2×</button>
    </div>
    <div class="manualRow editCalRow">
      <input id="editCal" type="number" inputmode="numeric" min="1" max="6000" placeholder="or type calories, e.g. ${base.kcal || 250}" />
      <span class="u">cal</span>
      <button type="button" class="bigBtn ghost" id="editCalSave">Set</button>
    </div>
    <button type="button" class="dangerBtn" id="editDelete">Remove from journal</button>
    <button type="button" class="sheetClose">Close</button>`;
  const backdrop = el('div', 'sheetBackdrop');
  wrap.append(backdrop, card);
  document.body.appendChild(wrap);

  const commit = (kcal, m, adjustedLabel) => {
    entry.base = base;
    entry.kcal = Math.round(kcal);
    entry.p = Math.round((base.p || 0) * m);
    entry.c = Math.round((base.c || 0) * m);
    entry.f = Math.round((base.f || 0) * m);
    entry.portion = adjustedLabel;
    saveDb();
    rerenderAll();
    refreshThreadCards();
    closeEntryEditor();
    showToast(`${entry.name}: now ${entry.kcal.toLocaleString()} cal ✓`, { ttl: 3500 });
  };
  for (const b of card.querySelectorAll('.scaleBtn')) {
    b.onclick = () => {
      const m = Number(b.dataset.m);
      commit(base.kcal * m, m, `${fmtMult(m)} × ${base.portion}`);
    };
  }
  card.querySelector('#editCalSave').onclick = () => {
    const v = Math.round(Number(card.querySelector('#editCal').value));
    if (!Number.isFinite(v) || v < 1 || v > 6000) return;
    const m = base.kcal > 0 ? v / base.kcal : 0;
    commit(v, m, `${base.portion} (adjusted)`);
  };
  card.querySelector('#editDelete').onclick = () => { closeEntryEditor(); deleteEntry(entry); };
  card.querySelector('.sheetClose').onclick = closeEntryEditor;
  backdrop.onclick = closeEntryEditor;
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
  $('camBtn').disabled = true;
  if (payload.photo) {
    const bubble = el('div', 'msg user snapMsg');
    const img = el('img');
    img.src = payload.photo.thumb;
    img.alt = 'your meal photo';
    bubble.appendChild(img);
    if (payload.text) bubble.appendChild(el('div', 'snapNote', esc(payload.text)));
    $('thread').appendChild(bubble);
    scrollChat();
  } else if (payload.label || payload.text) {
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
    if (data.needsConfirm) showConfirmChips(data.pendingItems);
    // First-ever logged food + still on the default goal → offer to tailor it.
    if ((data.entries || []).length && state.entries.length === data.entries.length
      && !state.flags.goalNudge && state.goal === 2000 && !state.profile?.age) {
      showGoalNudge();
    }
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

    rerenderAll();
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
    $('camBtn').disabled = false;
    // preventScroll: iOS scrolls overflow-hidden ancestors to reveal a
    // focused input, which would shove the header off-screen for good.
    $('logInput').focus({ preventScroll: true });
  }
}

/* ── photo capture ─────────────────────────────────────────────────── */
// Downscale + JPEG-compress a photo in the browser: one size for analysis,
// one small square-ish thumb that lives in the journal.
function compressPhoto(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const k = maxDim / Math.max(width, height);
        width = Math.round(width * k);
        height = Math.round(height * k);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}

async function sendPhoto(file) {
  if (!file || state.busy) return;
  const note = $('logInput').value.trim();
  $('logInput').value = '';
  navigator.vibrate?.(8);
  document.getElementById('confirmRow')?.remove();
  setView('chat');
  try {
    const [full, thumb] = await Promise.all([
      compressPhoto(file, 1024, 0.8),
      compressPhoto(file, 420, 0.72),
    ]);
    await send({ photo: { image: full.split(',')[1], mediaType: 'image/jpeg', thumb }, text: note });
  } catch {
    announce('Hmm, I couldn\'t read that image file — try another shot? 📷');
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
const VIEWS = { chat: ['chatView', 'tabChat'], journal: ['journalView', 'tabJournal'], trends: ['trendsView', 'tabTrends'] };
function setView(view) {
  if (!VIEWS[view]) view = 'chat';
  for (const [name, [viewId, tabId]] of Object.entries(VIEWS)) {
    $(viewId).hidden = name !== view;
    $(tabId).setAttribute('aria-selected', name === view);
  }
  $('composer').style.display = view === 'chat' ? '' : 'none';
  $('viewSwitch').dataset.v = view;
  if (view !== 'chat') $('stickyBar').classList.remove('show'); // bar is chat-only
  if (view === 'journal' && dirty.journal) { renderJournal(); dirty.journal = false; }
  if (view === 'trends' && dirty.trends) { renderTrends(); dirty.trends = false; }
  const incoming = $(VIEWS[view][0]);
  incoming.classList.remove('entering');
  void incoming.offsetWidth; // restart the entrance animation
  incoming.classList.add('entering');
  if (view === 'chat') scrollChat(false);
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

/* ── trends & insights ─────────────────────────────────────────────── */
// Everything here is computed from the journal on this device — nothing
// leaves the browser.
function trendData() {
  const byDay = dayMap();

  const lastN = (n) => {
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const dt = new Date(keyToDate(todayKey()));
      dt.setDate(dt.getDate() - i);
      const key = dateKeyOf(dt.getTime());
      const d = byDay.get(key);
      out.push({ key, dow: dt.getDay(), dayNum: dt.getDate(), kcal: d ? d.kcal : 0, p: d ? d.p : 0, c: d ? d.c : 0, f: d ? d.f : 0, logged: !!d, count: d ? d.count : 0 });
    }
    return out;
  };

  return { byDay, lastN, streak: currentStreak(byDay) };
}

function trendInsights(t, d30logged, weekAvgs) {
  const out = [];
  const say = (emoji, text) => out.push({ emoji, text });

  if (d30logged.length >= 3) {
    const avg = Math.round(d30logged.reduce((s, d) => s + d.kcal, 0) / d30logged.length);
    const diff = avg - state.goal;
    // A big chronic deficit is never something to cheer. Flag it kindly.
    if (avg < state.goal * 0.7) say('💛', `You're averaging ${avg.toLocaleString()} cal a day — quite a bit under your ${state.goal.toLocaleString()} goal. If some days are only half-logged, no worries. If that's really the whole day, your body would thank you for a little more fuel.`);
    else if (diff <= 0) say('🌿', `You're averaging ${avg.toLocaleString()} cal a day — ${Math.abs(diff).toLocaleString()} under your goal. Quietly excellent.`);
    else say('🔎', `You're averaging ${avg.toLocaleString()} cal a day — about ${diff.toLocaleString()} over goal. One swap a day (or a slightly kinder goal) closes it.`);

    const wkend = d30logged.filter((d) => d.dow === 0 || d.dow === 6);
    const wkday = d30logged.filter((d) => d.dow > 0 && d.dow < 6);
    if (wkend.length >= 2 && wkday.length >= 3) {
      const we = Math.round(wkend.reduce((s, d) => s + d.kcal, 0) / wkend.length);
      const wd = Math.round(wkday.reduce((s, d) => s + d.kcal, 0) / wkday.length);
      const gap = we - wd;
      if (gap > 150) say('🍔', `Weekends run about ${gap.toLocaleString()} cal heavier than weekdays (${we.toLocaleString()} vs ${wd.toLocaleString()}). That's the whole ballgame.`);
      else if (gap < -150) say('🧘', `Plot twist: your weekends are ${Math.abs(gap).toLocaleString()} cal lighter than weekdays. Weekday lunch is where the sneaky calories live.`);
    }

    const avgP = Math.round(d30logged.reduce((s, d) => s + d.p, 0) / d30logged.length);
    say('🥩', `Protein is averaging ${avgP}g a day. ${avgP >= 120 ? 'Solid — muscle approves.' : 'A shake or an extra chicken portion would push that up nicely.'}`);
  }

  const withData = weekAvgs.filter((w) => w.n > 0);
  if (withData.length >= 4) {
    const hi = withData.reduce((a, b) => (b.avg > a.avg ? b : a));
    const lo = withData.reduce((a, b) => (b.avg < a.avg ? b : a));
    if (hi.avg - lo.avg > 250) say('📅', `${hi.full}s are your biggest days (${hi.avg.toLocaleString()} cal avg); ${lo.full}s your lightest (${lo.avg.toLocaleString()}). Plan the big meals where they already happen.`);
  }

  const counts = new Map();
  for (const e of state.entries) counts.set(e.name, (counts.get(e.name) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 3) say('🏆', `House favorite: ${top[0]} — logged ${top[1]} times. At this point it deserves its own shelf.`);

  return out.slice(0, 5);
}

function renderTrends() {
  const view = $('trendsView');
  if (!view) return;
  view.innerHTML = '';

  const head = el('div', null, `
    <div id="trendsHead">
      <p class="eyebrow">Your patterns</p>
      <h2 class="dayTitle">Trends</h2>
    </div>`);
  view.appendChild(head);

  const t = trendData();
  const loggedDays = t.byDay.size;

  if (loggedDays < 3) {
    view.appendChild(el('div', 'tEmpty',
      `<div class="big">📈</div>Log a few days of meals and this page<br/>starts telling your story — patterns,<br/>streaks, and gentle nudges.`));
    return;
  }

  // ── your week — the marquee card ──
  const wk = weekRecapCard(t);
  if (wk) view.appendChild(wk);

  const d14 = t.lastN(14);
  const d30 = t.lastN(30);
  // A day with one stray coffee on it isn't a "300-cal day" — it's a partial
  // log. Averages and insights use substantial days; the chart shows all.
  const d30logged = d30.filter((d) => d.logged && (d.kcal >= 500 || d.count >= 2));
  const avg30 = d30logged.length ? Math.round(d30logged.reduce((s, d) => s + d.kcal, 0) / d30logged.length) : 0;
  // "On goal" is a band, not a ceiling — a 500-cal day on a 2,000 goal is
  // not on goal, it's underfueled.
  const onTarget = d30logged.filter((d) => d.kcal <= state.goal * 1.05 && d.kcal >= state.goal * 0.6).length;

  // ── headline stats ──
  const stats = el('div', 'tCard', `
    <div class="tLabel">At a glance <span class="tSub">last 30 days</span></div>
    <div class="tStats">
      <div class="tStat"><b class="rose">${t.streak}</b><span>day streak</span></div>
      <div class="tStat"><b>${avg30 ? avg30.toLocaleString() : '—'}</b><span>avg cal/day</span></div>
      <div class="tStat"><b>${d30logged.length ? `${onTarget}/${d30logged.length}` : '—'}</b><span>days on goal</span></div>
    </div>`);
  view.appendChild(stats);

  // ── insights ──
  const weekAvgs = (() => {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const fulls = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const b = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }));
    for (const d of t.lastN(56)) if (d.logged && (d.kcal >= 500 || d.count >= 2)) { b[d.dow].sum += d.kcal; b[d.dow].n++; }
    return b.map((x, i) => ({ name: names[i], full: fulls[i], avg: x.n ? Math.round(x.sum / x.n) : 0, n: x.n }));
  })();

  const insights = trendInsights(t, d30logged, weekAvgs);
  if (insights.length) {
    const card = el('div', 'tCard', `<div class="tLabel">Morsel noticed</div>`);
    for (const ins of insights) {
      card.appendChild(el('div', 'tInsight', `<span class="tEmoji">${ins.emoji}</span><p>${esc(ins.text)}</p>`));
    }
    view.appendChild(card);
  }

  // ── 14-day chart ──
  view.appendChild(calChartCard(d14));

  // ── weekday rhythm ──
  const withData = weekAvgs.filter((w) => w.n > 0);
  if (withData.length >= 3) {
    const card = el('div', 'tCard', `<div class="tLabel">Weekly rhythm <span class="tSub">avg cal by weekday</span></div>`);
    const max = Math.max(...weekAvgs.map((w) => w.avg), state.goal, 1);
    // Week runs Mon → Sun; feels more like a week.
    for (const i of [1, 2, 3, 4, 5, 6, 0]) {
      const w = weekAvgs[i];
      const row = el('div', 'tWeekRow', `
        <span class="wName">${w.name}</span>
        <span class="wTrack"><i class="wFill${w.avg > state.goal ? ' over' : ''}" style="width:${w.avg ? Math.max(3, (w.avg / max) * 100) : 0}%"></i></span>
        <span class="wVal">${w.avg ? w.avg.toLocaleString() : '·'}</span>`);
      card.appendChild(row);
    }
    view.appendChild(card);
  }

  // ── macro split ──
  if (d30logged.length >= 3) {
    const P = d30logged.reduce((s, d) => s + d.p, 0);
    const C = d30logged.reduce((s, d) => s + d.c, 0);
    const F = d30logged.reduce((s, d) => s + d.f, 0);
    const calSum = P * 4 + C * 4 + F * 9;
    if (calSum > 0) {
      const pp = Math.round((P * 4 / calSum) * 100);
      const cp = Math.round((C * 4 / calSum) * 100);
      const fp = Math.max(0, 100 - pp - cp);
      const card = el('div', 'tCard', `
        <div class="tLabel">Where the calories come from <span class="tSub">30-day split</span></div>
        <div class="tSplit"><i class="p" style="width:${pp}%"></i><i class="c" style="width:${cp}%"></i><i class="f" style="width:${fp}%"></i></div>
        <div class="tSplitKey">
          <span><i class="dot p"></i>Protein ${pp}%</span>
          <span><i class="dot c"></i>Carbs ${cp}%</span>
          <span><i class="dot f"></i>Fat ${fp}%</span>
        </div>`);
      view.appendChild(card);
    }
  }
}

// "Your week" — the screenshot-shaped card. Mon–Sun bars against the goal,
// a headline average, days on goal, and one warm line. Falls back to
// wrapping last week when the current one has barely started.
function weekRecapCard(t) {
  const today = keyToDate(todayKey());
  const monday = new Date(today);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));

  const weekOf = (start) => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const rec = t.byDay.get(dateKeyOf(d.getTime()));
    return { d, kcal: rec ? rec.kcal : 0, p: rec ? rec.p : 0, logged: !!rec, future: d > today };
  });

  let start = monday;
  let label = 'Your week';
  let days = weekOf(start);
  if (days.filter((x) => x.logged).length < 2) {
    const prev = new Date(monday);
    prev.setDate(prev.getDate() - 7);
    const prevDays = weekOf(prev);
    if (prevDays.filter((x) => x.logged).length >= 3) {
      start = prev; days = prevDays; label = 'Last week, wrapped';
    } else if (!days.some((x) => x.logged)) {
      return null;
    }
  }

  // Stats come from completed days — today's half-finished total would call a
  // 120-cal morning "on goal" and drag the average into fiction. Its bar
  // still draws, so the picture stays complete.
  const todayDateKey = todayKey();
  const allLogged = days.filter((x) => x.logged);
  const completed = allLogged.filter((x) => dateKeyOf(x.d.getTime()) !== todayDateKey);
  const logged = completed.length ? completed : allLogged;
  const avg = Math.round(logged.reduce((s, x) => s + x.kcal, 0) / logged.length);
  const onGoal = logged.filter((x) => x.kcal <= state.goal * 1.05 && x.kcal >= state.goal * 0.6).length;
  const avgP = Math.round(logged.reduce((s, x) => s + x.p, 0) / logged.length);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const range = `${MONTHS[start.getMonth()].slice(0, 3)} ${start.getDate()} – ${MONTHS[end.getMonth()].slice(0, 3)} ${end.getDate()}`;

  const max = Math.max(...days.map((x) => x.kcal), state.goal, 1);
  const letters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const cols = days.map((x, i) => {
    const h = x.logged ? Math.max(5, (x.kcal / max) * 100) : 0;
    const cls = x.future ? ' future' : x.logged ? (x.kcal > state.goal * 1.05 ? ' over' : '') : ' empty';
    return `<div class="wkCol${cls}">
      <div class="wkBarWrap">${x.logged ? `<i class="wkBar" style="height:${h.toFixed(1)}%"></i>` : x.future ? '' : '<i class="wkDot"></i>'}</div>
      <span class="wkDay">${letters[i]}</span>
    </div>`;
  }).join('');

  let line;
  if (avg < state.goal * 0.7) line = 'A light week — well under your goal. If that was the plan, okay; if not, a little more on the plate is still on plan. 💛';
  else if (logged.length >= 3 && onGoal === logged.length) line = 'Every logged day on goal. Frame this one. 🌟';
  else if (onGoal >= Math.ceil(logged.length / 2)) line = 'More days on goal than off — that\'s exactly how 90 days happen. 🌿';
  else line = 'A wobbly one — every good run has a few. The bars reset Monday; the streak is yours to keep. 🌱';

  const card = el('div', 'tCard wkCard', `
    <div class="tLabel">${label} <span class="tSub">${range}</span></div>
    <div class="wkHero">
      <div class="wkAvg"><b>${avg.toLocaleString()}</b><span>avg cal / day</span></div>
      <div class="wkFacts">
        <span class="wkFact"><b>${onGoal}/${logged.length}</b> on goal</span>
        <span class="wkFact"><b>${avgP}g</b> avg protein</span>
      </div>
    </div>
    <div class="wkGrid">
      <i class="wkGoalLine" style="bottom:${(19 + (state.goal / max) * 74).toFixed(1)}px"></i>
      ${cols}
    </div>
    <p class="wkLine">${line}</p>`);
  return card;
}

// The 14-day bars, drawn honestly: shared scale, dashed goal line.
function calChartCard(days) {
  const W = 420, H = 150, PAD = { t: 14, b: 20 };
  const innerH = H - PAD.t - PAD.b;
  const max = Math.max(...days.map((d) => d.kcal), state.goal, 1);
  const barW = W / days.length;
  const y = (v) => PAD.t + innerH * (1 - v / max);

  let bars = '';
  days.forEach((d, i) => {
    const x = i * barW + barW * 0.18;
    const w = barW * 0.64;
    const h = d.logged ? Math.max(3, innerH * (d.kcal / max)) : 3;
    const top = PAD.t + innerH - h;
    const fill = !d.logged ? 'rgba(63,31,42,0.08)' : d.kcal > state.goal * 1.05 ? '#c4083c' : 'url(#tg)';
    bars += `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(5, w / 2).toFixed(1)}" fill="${fill}"/>`;
    if (i % 2 === 0) bars += `<text x="${(i * barW + barW / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#86707a">${d.dayNum}</text>`;
  });

  const gy = y(state.goal);
  const card = el('div', 'tCard', `
    <div class="tLabel">Last 14 days <span class="tSub">goal ${state.goal.toLocaleString()} cal</span></div>
    <svg class="tChart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily calories, last 14 days">
      <defs>
        <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ff8aa1"/><stop offset="100%" stop-color="#e30b45"/>
        </linearGradient>
      </defs>
      ${bars}
      <line x1="0" x2="${W}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}" stroke="#2a191f" stroke-width="1.2" stroke-dasharray="5 5" opacity="0.35"/>
    </svg>
    <div class="tLegend"><span>2 weeks ago</span><span>today</span></div>`);
  return card;
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

let lastUnits = 'imperial';
function applyUnitToggle() {
  const metric = getSeg('gUnits') === 'metric';
  const units = metric ? 'metric' : 'imperial';
  // Flipping units converts what's already typed — 70 kg must never be
  // silently reread as 70 lb.
  if (units !== lastUnits) {
    const w = parseFloat($('gWeight').value);
    if (Number.isFinite(w) && w > 0) {
      $('gWeight').value = metric
        ? String(Math.round(w * 0.453592 * 10) / 10)
        : String(Math.round(w / 0.453592));
    }
    if (metric) {
      const ft = parseFloat($('gFt').value);
      if (Number.isFinite(ft)) {
        const inch = parseFloat($('gIn').value) || 0;
        $('gCm').value = String(Math.round((ft * 12 + inch) * 2.54));
      }
    } else {
      const cm = parseFloat($('gCm').value);
      if (Number.isFinite(cm) && cm > 0) {
        let totalIn = Math.round(cm / 2.54);
        $('gFt').value = String(Math.floor(totalIn / 12));
        $('gIn').value = String(totalIn % 12);
      }
    }
    lastUnits = units;
  }
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
  // The button visibly disables while the estimate is "—" — a live-looking
  // button that does nothing reads as broken.
  $('gUseRec').disabled = !recResult;
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
  lastUnits = p.units || 'imperial'; // stored values are already in these units
  applyUnitToggle();
  applyDirToggle();
  recompute();
  $('goalSheet').hidden = false;
}
function closeGoalSheet() { $('goalSheet').hidden = true; }

function setGoal(goal) {
  goal = Math.round(Number(goal));
  if (!Number.isFinite(goal) || goal < 500 || goal > 10000) {
    const note = $('gManualNote');
    note.textContent = 'Pick a goal between 500 and 10,000 calories.';
    note.hidden = false;
    return false;
  }
  $('gManualNote').hidden = true;
  state.goal = goal;
  saveDb();
  // Everything downstream measures against the goal — Trends and the journal
  // must never keep quoting the old one.
  rerenderAll();
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
    // Remember the real label once — a double-click must not capture "Saving…".
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.textContent = 'Saving…';
    setTimeout(() => { btn.textContent = btn.dataset.label; }, 600);
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
      $('gNote').textContent = 'Couldn\'t set the goal: ' + (err && err.message);
      $('gNote').classList.add('warn');
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
      const note = $('gManualNote');
      note.textContent = 'Couldn\'t set the goal: ' + (err && err.message);
      note.hidden = false;
    }
  };
  $('gClose').onclick = closeGoalSheet;
  $('goalSheet').querySelector('.sheetBackdrop').onclick = closeGoalSheet;
}

/* ── backup: the journal is the user's — give them a copy ──────────── */
function wireData() {
  $('dataExport').onclick = () => {
    const db = {
      app: 'morsel', version: 1, exportedAt: new Date().toISOString(),
      goal: state.goal, entries: state.entries, messages: state.messages,
      profile: state.profile, flags: state.flags,
    };
    const blob = new Blob([JSON.stringify(db)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `morsel-journal-${todayKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    showToast('Backup downloaded — keep it somewhere safe. 🗄️', { ttl: 4000 });
  };
  $('dataImport').onclick = () => $('importFile').click();
  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.entries)) throw new Error('not a Morsel backup');
      // Merge, never replace: restoring can only add entries, so a wrong file
      // (or a re-import) can't cost anyone their journal.
      const have = new Set(state.entries.map((x) => x.id));
      const incoming = data.entries.filter((x) =>
        x && x.id && !have.has(x.id) && x.dateKey && Number.isFinite(x.kcal));
      state.entries.push(...incoming);
      state.entries.sort((a, b) => a.ts - b.ts);
      if (!have.size) {
        // Fresh browser adopting a backup wholesale — bring the rest along.
        state.goal = data.goal || state.goal;
        state.profile = data.profile || state.profile;
        state.flags = data.flags || state.flags;
        if (Array.isArray(data.messages) && data.messages.length) state.messages = data.messages;
      }
      saveDb();
      rerenderAll();
      renderThread();
      closeGoalSheet();
      showToast(incoming.length
        ? `Welcome back — restored ${incoming.length.toLocaleString()} entr${incoming.length === 1 ? 'y' : 'ies'} ✓`
        : 'That backup matches what\'s already here — nothing to add. ✓', { ttl: 5000 });
    } catch {
      showToast('That file doesn\'t look like a Morsel backup — nothing was changed.', { ttl: 5000 });
    }
  });
}

// One gentle, one-time reminder once a real journal exists.
function maybeBackupNudge() {
  const daysLogged = dayMap().size;
  if (state.flags.backupNudge || daysLogged < 7) return;
  state.flags.backupNudge = true;
  const span = daysLogged === 7 ? 'A week' : `${daysLogged} days`;
  state.messages.push({
    id: nid(), role: 'bot',
    text: `${span} of journaling — look at you. 🗄️ One housekeeping thing: your journal lives only in this browser. Tap your goal number up top and grab a backup file once in a while; it's yours forever and moves to any new phone.`,
    ts: Date.now(),
  });
  saveDb();
}

/* ── morning recap ─────────────────────────────────────────────────── */
// "Yesterday, wrapped" the first time a new day opens — computed locally,
// celebrating rather than auditing. Runs before the first render so it
// appears as the latest message in the thread.
function maybeMorningRecap() {
  const today = todayKey();
  if (state.flags.recapDay === today) return;
  state.flags.recapDay = today;
  if (todayEntries().length) { saveDb(); return; } // day already underway
  const yKey = dateKeyOf(Date.now() - 86400000);
  const y = state.entries.filter((e) => e.dateKey === yKey);
  if (!y.length) { saveDb(); return; }
  const kcal = y.reduce((s, e) => s + e.kcal, 0);
  const p = y.reduce((s, e) => s + (e.p || 0), 0);
  const diff = kcal - state.goal;
  let line;
  if (diff > 150) {
    line = `Yesterday, wrapped: ${kcal.toLocaleString()} cal — a bigger day. Fresh page today. 🌱`;
  } else if (diff >= -600) {
    line = `Yesterday, wrapped: ${kcal.toLocaleString()} cal and ${p}g protein — right in the zone around your ${state.goal.toLocaleString()} goal. 🎯`;
  } else {
    line = `Yesterday, wrapped: ${kcal.toLocaleString()} cal — a light one. Listen to what your body asks for today.`;
  }
  const streak = currentStreak();
  if (streak >= 2) line += ` That's ${streak} days in a row of showing up. 🔥`;
  state.messages.push({ id: nid(), role: 'bot', text: line, ts: Date.now() });
  saveDb();
}

/* ── boot ──────────────────────────────────────────────────────────── */
async function init() {
  $('logForm').addEventListener('submit', (e) => { e.preventDefault(); sendLog(); });
  $('tabChat').onclick = () => setView('chat');
  $('tabJournal').onclick = () => setView('journal');
  $('tabTrends').onclick = () => setView('trends');
  $('camBtn').onclick = () => { if (!state.busy) $('photoInput').click(); };
  $('photoInput').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // same photo can be picked again next time
    if (file) sendPhoto(file);
  });
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
  state.flags = db.flags || {};
  saveDb(); // migrate legacy key forward
  state.celebratedToday = todayEntries().reduce((s, e) => s + e.kcal, 0) >= state.goal;
  maybeMorningRecap();
  maybeBackupNudge();
  wireData();

  renderSummary();
  renderThread();
  dirty.journal = true;
  dirty.trends = true;
  setView('chat');
  watchStickyBar();

  // #phone is overflow:hidden and must never scroll — but focus() and
  // scrollIntoView() on descendants can still shift it, stranding the header
  // off-screen with no way back. Snap it home if anything tries.
  const phone = $('phone');
  phone.addEventListener('scroll', () => { phone.scrollTop = 0; phone.scrollLeft = 0; });

  // Real-app plumbing: the service worker makes the shell load offline, and
  // persistent storage asks the browser not to evict the journal. Both are
  // best-effort — the single-file build opened from file:// skips them.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  navigator.storage?.persist?.().catch(() => {});

  await detectApi(); // non-blocking for the UI; just upgrades the brain
}

init();
