// Builds dist/morsel.html — a single-file, fully client-side Morsel.
// It inlines the stylesheet, the food database, the parser, and the
// placeholder art, then shims window.fetch so the unmodified front-end
// talks to an in-browser engine (localStorage) instead of the server.
// Nano banana photos and live USDA lookups need the real server + keys;
// everything else works identically.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Strip CommonJS plumbing so lib files run as plain browser script.
function browserify(src) {
  return src
    .replace(/^const .*= require\(.*\);\s*$/gm, '')
    .replace(/^module\.exports = .*$/gm, '');
}

const css = read('public/app.css');
const html = read('public/index.html');
const body = html.match(/<body>([\s\S]*?)<script src="app\.js">/)[1];
const libs = ['lib/foods.js', 'lib/parser.js', 'lib/placeholder.js']
  .map((f) => browserify(read(f)))
  .join('\n');
const appJs = read('public/app.js');

const engine = String.raw`
/* ── In-browser Morsel engine (demo build) ─────────────────────────── */
const DB_KEY = 'morsel-demo-v1';

function nid() { return Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10); }
function dateKeyOf(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function imageFor(name, emoji) {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(placeholderSvg(name, emoji || '🍽️'));
}

const GREETING = 'Hi, I\'m Morsel. Tell me what you eat the way you\'d text a friend — "had a latte and a bagel" is plenty. I\'ll keep the journal, the math, and the pictures. What have you had so far?';

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
      image: imageFor(food.aliases[0], food.emoji),
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
  try {
    const db = JSON.parse(localStorage.getItem(DB_KEY));
    if (db && Array.isArray(db.entries)) return db;
  } catch {}
  return seedDb();
}
let db = loadDb();
function saveDb() { try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch {} }
saveDb();

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function fallbackReply(items, totalToday, goal) {
  const remaining = goal - totalToday;
  const names = items.map((i) => i.name).join(' and ');
  if (remaining > 400) return pick([
    'Logged the ' + names.toLowerCase() + " — you've got " + remaining.toLocaleString() + ' cal of runway left today. 🌤️',
    names + ' — noted! Still ' + remaining.toLocaleString() + ' cal to play with today.',
  ]);
  if (remaining > 100) return pick([
    'Lovely — that leaves ' + remaining.toLocaleString() + ' cal for the rest of the day.',
    "Logged! You're cruising — " + remaining.toLocaleString() + ' cal left before your target.',
  ]);
  if (remaining > -150) return pick([
    'That lands you right around your target for the day. 🎯',
    'Nicely done — that nudges you right up to your target.',
  ]);
  return pick([
    'That puts you ' + Math.abs(remaining).toLocaleString() + " over today — tomorrow's a fresh page. 🌱",
    'A little over today (' + Math.abs(remaining).toLocaleString() + ' cal) — happens to the best of us.',
  ]);
}

const NO_FOOD_REPLIES = [
  'Hmm, I couldn\'t spot a food in that. Try something like "had a cappuccino and an almond croissant". ☕',
  'I didn\'t catch a food there — tell me something like "two eggs and toast" and I\'ll do the rest. 🍳',
];

function apiLog(payload) {
  const { text = '', confirm = false, skip = false, label } = payload;
  const now = Date.now();

  if (skip) {
    db.messages.push({ id: nid(), role: 'user', text: label || 'Same plate — skip it', ts: now });
    const reply = 'Got it — left it off the journal. 👌';
    db.messages.push({ id: nid(), role: 'bot', text: reply, ts: now });
    saveDb();
    return { status: 200, body: { reply, entries: [] } };
  }

  const trimmed = String(text).trim().slice(0, 500);
  if (!trimmed) return { status: 400, body: { error: 'Tell me what you ate first!' } };

  db.messages.push({ id: nid(), role: 'user', text: label || trimmed, ts: now });

  const items = parseLocally(trimmed);
  if (!items.length) {
    const reply = pick(NO_FOOD_REPLIES);
    db.messages.push({ id: nid(), role: 'bot', text: reply, ts: now });
    saveDb();
    return { status: 200, body: { reply, entries: [] } };
  }

  if (!confirm) {
    const todayNames = new Set(db.entries.filter((e) => e.dateKey === dateKeyOf(now)).map((e) => e.name.toLowerCase()));
    const dupes = items.filter((i) => todayNames.has(i.name.toLowerCase()));
    if (dupes.length) {
      const what = dupes.map((d) => d.name.toLowerCase()).join(' and ');
      const reply = 'Looks like I already logged ' + (what.includes(' and ') ? 'those' : 'that') + ' ' + what +
        ' a moment ago — want me to add a second helping, or was that the same plate?';
      db.messages.push({ id: nid(), role: 'bot', text: reply, ts: now });
      saveDb();
      return { status: 200, body: { reply, entries: [], needsConfirm: true, originalText: trimmed } };
    }
  }

  const entries = items.map((item) => ({
    id: nid(), ts: now, dateKey: dateKeyOf(now),
    name: item.name, emoji: item.emoji || '🍽️', portion: item.portion || '1 serving',
    image: imageFor(item.name, item.emoji),
    kcal: item.kcal, p: item.p, c: item.c, f: item.f, source: 'builtin',
  }));
  db.entries.push(...entries);

  const totalToday = db.entries.filter((e) => e.dateKey === dateKeyOf(now)).reduce((s, e) => s + e.kcal, 0);
  const reply = fallbackReply(entries, totalToday, db.goal);
  db.messages.push({ id: nid(), role: 'bot', text: reply, ts: now, entryIds: entries.map((e) => e.id) });
  saveDb();
  return { status: 200, body: { reply, entries, totalToday, goal: db.goal } };
}

// fetch shim: routes /api/* to the in-browser engine so app.js runs unmodified.
window.fetch = async function (url, opts = {}) {
  const respond = ({ status, body }) => ({ ok: status < 400, status, json: async () => body });
  if (url === '/api/state') {
    return respond({ status: 200, body: { goal: db.goal, entries: db.entries, messages: db.messages, capabilities: { gemini: false, usdaKey: false } } });
  }
  if (url === '/api/log') return respond(apiLog(JSON.parse(opts.body)));
  if (url === '/api/settings') {
    const goal = Math.round(Number(JSON.parse(opts.body).goal));
    if (!Number.isFinite(goal) || goal < 500 || goal > 10000) {
      return respond({ status: 400, body: { error: 'Goal must be between 500 and 10,000 cal.' } });
    }
    db.goal = goal; saveDb();
    return respond({ status: 200, body: { goal } });
  }
  const del = url.match(/^\/api\/entries\/(.+)$/);
  if (del && opts.method === 'DELETE') {
    const before = db.entries.length;
    db.entries = db.entries.filter((e) => e.id !== del[1]);
    saveDb();
    return respond(before === db.entries.length ? { status: 404, body: { error: 'Not found' } } : { status: 200, body: { ok: true } });
  }
  return respond({ status: 404, body: { error: 'Unknown route ' + url } });
};
`;

const out = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#fdf6f3" />
<title>Morsel — a delightful calorie tracker</title>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="Morsel" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🍓</text></svg>" />
<link rel="apple-touch-icon" href="icon.png" />
<link rel="manifest" href="manifest.webmanifest" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..700&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<style>
${css}
</style>
</head>
<body>${body}<script>
${libs}
${engine}
${appJs}
</script>
</body>
</html>
`;

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', 'morsel.html'), out);
fs.copyFileSync(path.join(ROOT, 'public', 'icon.png'), path.join(ROOT, 'dist', 'icon.png'));
fs.copyFileSync(path.join(ROOT, 'public', 'manifest.webmanifest'), path.join(ROOT, 'dist', 'manifest.webmanifest'));
console.log(`dist/morsel.html — ${(out.length / 1024).toFixed(0)} KB (+ icon.png, manifest.webmanifest)`);
