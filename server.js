// Morsel server — a stateless "brain". It holds the API keys and does the
// smart work (Gemini parsing, USDA nutrition, nano banana photos), but it
// stores NOTHING: every journal lives in its owner's browser. That means one
// deployment can serve any number of people without anyone sharing data.
const express = require('express');
const path = require('path');

// Load .env if present (Node 20.12+).
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* no .env — fine */ }

const { parseLocally } = require('./lib/parser');
const { findFood } = require('./lib/foods');
const { usdaLookup, scalePortion } = require('./lib/usda');
const { geminiAvailable, geminiParse, geminiImage, geminiPingText, geminiPingImage } = require('./lib/gemini');
const { placeholderSvg } = require('./lib/placeholder');
const { browserEngine } = require('./lib/bundle');

const PORT = process.env.PORT || 3000;
const ACCESS_CODE = process.env.ACCESS_CODE || '';

// sharp is optional — when present, generated photos are compressed from
// ~1.5 MB PNGs to ~40 KB JPEGs before being sent to (and stored by) clients.
let sharp = null;
try { sharp = require('sharp'); } catch { /* fine, ship PNGs */ }

/* ── nutrition: USDA first, then the parser's USDA-derived estimates ── */
async function resolveNutrition(item) {
  const usda = await usdaLookup(item.usdaQuery || item.name);
  if (usda && usda.kcal > 0 && item.grams > 0) {
    const scaled = scalePortion(usda, item.grams);
    // Sanity-check the scaling against the parser's estimate: a bad gram
    // guess against per-100g data can be wildly off for drinks/soups.
    const est = item.kcal || scaled.kcal;
    if (scaled.kcal > est / 3 && scaled.kcal < est * 3) {
      return { kcal: scaled.kcal, p: scaled.p, c: scaled.c, f: scaled.f, source: 'usda' };
    }
  }
  return { kcal: item.kcal, p: item.p, c: item.c, f: item.f, source: item.source || 'estimate' };
}

/* ── images: nano banana, compressed when possible ───────────────────── */
async function makeImage(item, warnings) {
  if (geminiAvailable()) {
    try {
      let png = await geminiImage(item.name, item.portion);
      if (png) {
        if (sharp) {
          const jpeg = await sharp(png).resize(512, 512, { fit: 'cover' }).jpeg({ quality: 74 }).toBuffer();
          return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
        }
        return `data:image/png;base64,${png.toString('base64')}`;
      }
      warnings.push('nano banana returned no image');
    } catch (err) {
      console.warn(`nano banana image failed for "${item.name}": ${err.message}`);
      warnings.push(`image generation: ${err.message.slice(0, 220)}`);
    }
  }
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(placeholderSvg(item.name, item.emoji || '🍽️'));
}

/* ── app ─────────────────────────────────────────────────────────────── */
const app = express();
app.use(express.json({ limit: '64kb' }));

// CORS: the client may be served from GitHub Pages (or anywhere) while the
// brain lives here. No cookies, no personal data — open CORS is fine, and
// ACCESS_CODE gates actual usage when set.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-Morsel-Key');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const ENGINE_JS = browserEngine();
app.get('/engine.js', (req, res) => {
  res.type('application/javascript').set('Cache-Control', 'public, max-age=300').send(ENGINE_JS);
});

// Live diagnosis: open /api/selftest in a browser to see exactly what Google
// says about your key. Add ?image=1 to also test nano banana (generates one
// tiny image, which counts against quota).
app.get('/api/selftest', async (req, res) => {
  const out = { keyPresent: geminiAvailable() };
  if (!out.keyPresent) return res.json({ ...out, hint: 'Set GEMINI_API_KEY in the server environment.' });
  try { out.textModel = await geminiPingText(); }
  catch (err) { out.textModel = err.message; }
  if (req.query.image) {
    try { out.imageModel = await geminiPingImage(); }
    catch (err) { out.imageModel = err.message; }
  } else {
    out.imageModel = 'skipped — add ?image=1 to test (uses one generation)';
  }
  res.json(out);
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    gemini: geminiAvailable(),
    usda: true, // built-in fallback always available; live API used when reachable
    needsKey: Boolean(ACCESS_CODE),
  });
});

app.post('/api/analyze', async (req, res) => {
  if (ACCESS_CODE && req.get('X-Morsel-Key') !== ACCESS_CODE) {
    return res.status(401).json({ error: 'Access code required', needsKey: true });
  }

  const text = String(req.body.text || '').trim().slice(0, 500);
  if (!text) return res.status(400).json({ error: 'Tell me what you ate first!' });
  const context = req.body.context || {};

  // 1. Parse — Gemini understands anything; the local parser knows ~120 foods.
  const warnings = [];
  let items = [];
  let reply = null;
  if (geminiAvailable()) {
    try {
      const ctx = `Daily goal ${context.goal || 2000} cal; ${context.totalToday || 0} cal logged so far today.`;
      const parsed = await geminiParse(text, ctx);
      items = parsed.items || [];
      reply = parsed.reply || null;
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
      warnings.push(`meal parsing: ${err.message.slice(0, 220)}`);
    }
  }
  if (!items.length) {
    items = parseLocally(text);
    reply = null;
  }
  if (!items.length) return res.json({ items: [], reply: null, warnings });

  // 2. Nutrition (USDA) + photos (nano banana) — computed, returned, forgotten.
  const out = [];
  for (const item of items.slice(0, 6)) {
    const nutrition = await resolveNutrition(item);
    const image = await makeImage(item, warnings);
    out.push({
      name: item.name,
      emoji: item.emoji || '🍽️',
      portion: item.portion || '1 serving',
      image,
      ...nutrition,
    });
  }
  res.json({ items: out, reply, warnings: warnings.slice(0, 3) });
});

app.listen(PORT, () => {
  console.log(`\n  🍓 Morsel is ready → http://localhost:${PORT}\n`);
  console.log(`  nano banana images : ${geminiAvailable() ? 'on (gemini-2.5-flash-image)' : 'off — set GEMINI_API_KEY for real food photos'}`);
  console.log(`  image compression  : ${sharp ? 'on (sharp)' : 'off — npm i sharp for smaller photos'}`);
  console.log(`  USDA FoodData      : ${process.env.USDA_API_KEY ? 'API key set' : 'using DEMO_KEY (set USDA_API_KEY for headroom)'}`);
  console.log(`  access code        : ${ACCESS_CODE ? 'required' : 'open (set ACCESS_CODE to restrict who can use your keys)'}\n`);
});
