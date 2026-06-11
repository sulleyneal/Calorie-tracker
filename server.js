const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env if present (Node 20.12+).
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* no .env — fine */ }

const { parseLocally } = require('./lib/parser');
const { findFood } = require('./lib/foods');
const { usdaLookup, scalePortion } = require('./lib/usda');
const { geminiAvailable, geminiParse, geminiImage } = require('./lib/gemini');
const { placeholderSvg } = require('./lib/placeholder');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const IMAGES_DIR = path.join(DATA_DIR, 'images');
const DB_PATH = path.join(DATA_DIR, 'db.json');

fs.mkdirSync(IMAGES_DIR, { recursive: true });

// ── Tiny JSON store ─────────────────────────────────────────────────
const GREETING =
  "Hi, I'm Morsel. Tell me what you eat the way you'd text a friend — " +
  '"had a latte and a bagel" is plenty. I\'ll keep the journal, the math, ' +
  'and the pictures. What have you had so far?';

function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { goal: 2000, entries: [], messages: [{ id: nid(), role: 'bot', text: GREETING, ts: Date.now() }] };
  }
}
function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
function nid() {
  return crypto.randomBytes(8).toString('hex');
}
function dateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let db = loadDb();

// ── Nutrition: USDA first, then built-in/Gemini estimates ───────────
async function resolveNutrition(item) {
  const usda = await usdaLookup(item.usdaQuery || item.name);
  if (usda && usda.kcal > 0 && item.grams > 0) {
    const scaled = scalePortion(usda, item.grams);
    // Sanity-check the scaling against the parser's estimate: a bad gram
    // guess against per-100g data can be wildly off for drinks/soups.
    const est = item.kcal || scaled.kcal;
    if (scaled.kcal > est / 3 && scaled.kcal < est * 3) {
      return { ...scaled, source: 'usda', sourceDetail: usda.description };
    }
  }
  return { kcal: item.kcal, p: item.p, c: item.c, f: item.f, source: item.source || 'estimate' };
}

// ── Images: nano banana, falling back to illustrated plates ─────────
async function makeImage(item) {
  if (geminiAvailable()) {
    try {
      const png = await geminiImage(item.name, item.portion);
      if (png) {
        const file = `${nid()}.png`;
        fs.writeFileSync(path.join(IMAGES_DIR, file), png);
        return `/images/${file}`;
      }
    } catch (err) {
      console.warn(`nano banana image failed for "${item.name}": ${err.message}`);
    }
  }
  const file = `${nid()}.svg`;
  fs.writeFileSync(path.join(IMAGES_DIR, file), placeholderSvg(item.name, item.emoji || '🍽️'));
  return `/images/${file}`;
}

// ── Morsel's voice (offline fallback replies) ───────────────────────
function fallbackReply(items, totalToday, goal) {
  const remaining = goal - totalToday;
  const names = items.map((i) => i.name).join(' and ');
  if (remaining > 400) {
    return pick([
      `Logged the ${names.toLowerCase()} — you've got ${remaining.toLocaleString()} cal of runway left today. 🌤️`,
      `${names} — noted! Still ${remaining.toLocaleString()} cal to play with today.`,
    ]);
  }
  if (remaining > 100) {
    return pick([
      `Lovely — that leaves ${remaining.toLocaleString()} cal for the rest of the day.`,
      `Logged! You're cruising — ${remaining.toLocaleString()} cal left before your target.`,
    ]);
  }
  if (remaining > -150) {
    return pick([
      `That lands you right around your target for the day. 🎯`,
      `Nicely done — that nudges you right up to your target.`,
    ]);
  }
  return pick([
    `That puts you ${Math.abs(remaining).toLocaleString()} over today — tomorrow's a fresh page. 🌱`,
    `A little over today (${Math.abs(remaining).toLocaleString()} cal) — happens to the best of us.`,
  ]);
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const NO_FOOD_REPLIES = [
  `Hmm, I couldn't spot a food in that. Try something like "had a cappuccino and an almond croissant". ☕`,
  `I didn't catch a food there — tell me something like "two eggs and toast" and I'll do the rest. 🍳`,
];

// ── App ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(IMAGES_DIR, { maxAge: '365d', immutable: true }));

app.get('/api/state', (req, res) => {
  res.json({
    goal: db.goal,
    entries: db.entries,
    messages: db.messages,
    capabilities: { gemini: geminiAvailable(), usdaKey: Boolean(process.env.USDA_API_KEY) },
  });
});

app.post('/api/settings', (req, res) => {
  const goal = Math.round(Number(req.body.goal));
  if (!Number.isFinite(goal) || goal < 500 || goal > 10000) {
    return res.status(400).json({ error: 'Goal must be between 500 and 10,000 cal.' });
  }
  db.goal = goal;
  saveDb(db);
  res.json({ goal });
});

app.delete('/api/entries/:id', (req, res) => {
  const before = db.entries.length;
  db.entries = db.entries.filter((e) => e.id !== req.params.id);
  if (db.entries.length === before) return res.status(404).json({ error: 'Not found' });
  saveDb(db);
  res.json({ ok: true });
});

app.post('/api/log', async (req, res) => {
  const { text = '', confirm = false, skip = false, label } = req.body;
  const now = Date.now();

  // User said "same plate" to a duplicate prompt — acknowledge, log nothing.
  if (skip) {
    db.messages.push({ id: nid(), role: 'user', text: label || 'Same plate — skip it', ts: now });
    const reply = 'Got it — left it off the journal. 👌';
    db.messages.push({ id: nid(), role: 'bot', text: reply, ts: now });
    saveDb(db);
    return res.json({ reply, entries: [] });
  }

  const trimmed = String(text).trim().slice(0, 500);
  if (!trimmed) return res.status(400).json({ error: 'Tell me what you ate first!' });

  db.messages.push({ id: nid(), role: 'user', text: label || trimmed, ts: now });

  // 1. Parse — Gemini understands anything; the local parser knows ~120 foods.
  let items = [];
  let aiReply = null;
  if (geminiAvailable()) {
    try {
      const today = db.entries.filter((e) => e.dateKey === dateKey(now));
      const totalToday = today.reduce((s, e) => s + e.kcal, 0);
      const context = `Daily goal ${db.goal} cal; ${totalToday} cal logged so far today.`;
      const parsed = await geminiParse(trimmed, context);
      items = parsed.items || [];
      aiReply = parsed.reply || null;
      // Enrich with built-in DB defaults where Gemini was vague.
      for (const item of items) {
        const known = findFood(item.name);
        if (known) {
          item.usdaQuery = item.usdaQuery || known.usda;
          item.emoji = item.emoji || known.emoji;
          if (!item.grams) item.grams = known.grams;
        }
      }
    } catch (err) {
      console.warn(`Gemini parse failed, using local parser: ${err.message}`);
    }
  }
  if (!items.length) {
    items = parseLocally(trimmed);
    aiReply = null; // gemini reply (if any) was about a failed parse
  }

  if (!items.length) {
    const reply = pick(NO_FOOD_REPLIES);
    db.messages.push({ id: nid(), role: 'bot', text: reply, ts: now });
    saveDb(db);
    return res.json({ reply, entries: [] });
  }

  // 2. The "same plate?" moment — if any of this is already in today's
  //    journal, check before double-logging.
  if (!confirm) {
    const todayNames = new Set(
      db.entries.filter((e) => e.dateKey === dateKey(now)).map((e) => e.name.toLowerCase())
    );
    const dupes = items.filter((i) => todayNames.has(i.name.toLowerCase()));
    if (dupes.length) {
      const what = dupes.map((d) => d.name.toLowerCase()).join(' and ');
      const reply = `Looks like I already logged ${what.includes(' and ') ? 'those' : 'that'} ${what} a moment ago — want me to add a second helping, or was that the same plate?`;
      db.messages.push({ id: nid(), role: 'bot', text: reply, ts: now });
      saveDb(db);
      return res.json({ reply, entries: [], needsConfirm: true, originalText: trimmed });
    }
  }

  // 3. Nutrition (USDA) + photos (nano banana), then commit to the journal.
  const entries = [];
  for (const item of items) {
    const nutrition = await resolveNutrition(item);
    const image = await makeImage(item);
    entries.push({
      id: nid(),
      ts: now,
      dateKey: dateKey(now),
      name: item.name,
      emoji: item.emoji || '🍽️',
      portion: item.portion || '1 serving',
      image,
      ...nutrition,
    });
  }
  db.entries.push(...entries);

  const totalToday = db.entries
    .filter((e) => e.dateKey === dateKey(now))
    .reduce((s, e) => s + e.kcal, 0);
  const reply = aiReply || fallbackReply(entries, totalToday, db.goal);
  db.messages.push({ id: nid(), role: 'bot', text: reply, ts: now, entryIds: entries.map((e) => e.id) });
  saveDb(db);

  res.json({ reply, entries, totalToday, goal: db.goal });
});

app.listen(PORT, () => {
  console.log(`\n  🍓 Morsel is ready → http://localhost:${PORT}\n`);
  console.log(`  nano banana images : ${geminiAvailable() ? 'on (gemini-2.5-flash-image)' : 'off — set GEMINI_API_KEY for real food photos'}`);
  console.log(`  USDA FoodData      : ${process.env.USDA_API_KEY ? 'API key set' : 'using DEMO_KEY (set USDA_API_KEY for headroom)'}\n`);
});
