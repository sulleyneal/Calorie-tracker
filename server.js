// Morsel server — a stateless "brain". It holds the API keys and does the
// smart work (meal parsing and USDA nutrition), but it stores NOTHING: every
// journal lives in its owner's browser. That means one deployment can serve
// any number of people without anyone sharing data.
//
// Food images are illustrated plates by default. AI photo generation is an
// optional extra, off unless ENABLE_IMAGES=true (it needs Gemini billing).
const express = require('express');
const path = require('path');

// Load .env if present (Node 20.12+).
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* no .env — fine */ }

const { parseLocally } = require('./lib/parser');
const { findFood } = require('./lib/foods');
const { usdaLookup, scalePortion } = require('./lib/usda');
const { geminiAvailable, geminiParse, geminiParsePhoto, geminiImage, geminiPingText, geminiPingImage } = require('./lib/gemini');
const { groqAvailable, groqParse, groqParsePhoto, groqPing } = require('./lib/groq');
const { placeholderSvg } = require('./lib/placeholder');
const { browserEngine } = require('./lib/bundle');

const PORT = process.env.PORT || 3000;
const ACCESS_CODE = process.env.ACCESS_CODE || '';
// AI food-photo generation is off by default; the app uses illustrated plates.
// Set ENABLE_IMAGES=true (and enable Gemini billing) to turn real photos on.
const ENABLE_IMAGES = /^(1|true|yes)$/i.test(process.env.ENABLE_IMAGES || '');

// sharp is optional — when present, generated photos are compressed from
// ~1.5 MB PNGs to ~40 KB JPEGs before being sent to (and stored by) clients.
let sharp = null;
try { sharp = require('sharp'); } catch { /* fine, ship PNGs */ }

/* ── nutrition: USDA first, then the parser's USDA-derived estimates ── */
async function resolveNutrition(item) {
  // Branded/restaurant items: trust the model's menu knowledge. A generic
  // USDA lookup ("onion rings") would replace an accurate branded value
  // (Whataburger large onion rings) with a generic one.
  if (item.branded || item.usdaQuery === '') {
    return { kcal: item.kcal, p: item.p, c: item.c, f: item.f, source: 'branded' };
  }
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

/* ── images: illustrated plates by default; AI photos only if enabled ── */
async function makeImage(item) {
  if (ENABLE_IMAGES && geminiAvailable()) {
    try {
      const png = await geminiImage(item.name, item.portion);
      if (png) {
        if (sharp) {
          const jpeg = await sharp(png).resize(512, 512, { fit: 'cover' }).jpeg({ quality: 74 }).toBuffer();
          return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
        }
        return `data:image/png;base64,${png.toString('base64')}`;
      }
    } catch (err) {
      console.warn(`AI photo failed for "${item.name}": ${err.message}`);
    }
  }
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(placeholderSvg(item.name, item.emoji || '🍽️'));
}

/* ── app ─────────────────────────────────────────────────────────────── */
const app = express();
// Parse JSON bodies sent as either application/json OR text/plain. The client
// uses text/plain so its POST stays a "simple" CORS request (no preflight),
// which avoids a class of cross-origin failures on mobile browsers.
// Photo uploads need a bigger body allowance than text logs; everything else
// keeps the tight 64kb cap.
const jsonSmall = express.json({ type: ['application/json', 'text/plain'], limit: '64kb' });
const jsonPhoto = express.json({ type: ['application/json', 'text/plain'], limit: '8mb' });
app.use((req, res, next) => (req.path === '/api/photo' ? jsonPhoto(req, res, next) : jsonSmall(req, res, next)));

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

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m' }));

const ENGINE_JS = browserEngine();
app.get('/engine.js', (req, res) => {
  res.type('application/javascript').set('Cache-Control', 'public, max-age=300').send(ENGINE_JS);
});

// Live diagnosis: open /api/selftest in a browser to see exactly what each
// provider says about your keys. Add ?image=1 to also test AI photo
// generation (generates one tiny image, which counts against quota).
app.get('/api/selftest', async (req, res) => {
  const out = {
    geminiKey: geminiAvailable(),
    groqKey: groqAvailable(),
  };
  if (geminiAvailable()) {
    try { out.geminiText = await geminiPingText(); }
    catch (err) { out.geminiText = err.message; }
  }
  if (groqAvailable()) {
    try { out.groqText = await groqPing(); }
    catch (err) { out.groqText = err.message; }
  }
  if (!geminiAvailable() && !groqAvailable()) {
    out.hint = 'Set GEMINI_API_KEY and/or GROQ_API_KEY in the server environment for smart parsing.';
  }
  if (req.query.image && geminiAvailable()) {
    try { out.imageModel = await geminiPingImage(); }
    catch (err) { out.imageModel = err.message; }
  } else {
    out.imageModel = 'skipped — add ?image=1 to test (needs Gemini billing, uses one generation)';
  }
  res.json(out);
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    gemini: geminiAvailable(),
    groq: groqAvailable(),
    smartParse: geminiAvailable() || groqAvailable(),
    photo: geminiAvailable() || groqAvailable(), // photo logging needs a vision provider
    usda: true, // built-in fallback always available; live API used when reachable
    needsKey: Boolean(ACCESS_CODE),
  });
});

/* ── photo logging: a meal photo (+ optional note) → parsed items ────── */
app.post('/api/photo', async (req, res) => {
  const key = req.get('X-Morsel-Key') || (req.body && req.body.key);
  if (ACCESS_CODE && key !== ACCESS_CODE) {
    return res.status(401).json({ error: 'Access code required', needsKey: true });
  }

  const image = String(req.body.image || '');
  const mediaType = /^image\/(jpeg|png|webp|heic|heif)$/.test(req.body.mediaType) ? req.body.mediaType : 'image/jpeg';
  const note = String(req.body.note || '').trim().slice(0, 300);
  if (!image || image.length < 100) return res.status(400).json({ error: 'Send a photo of the meal.' });
  if (image.length > 7 * 1024 * 1024) return res.status(413).json({ error: 'That photo is too large — try again, it should compress automatically.' });
  if (!geminiAvailable() && !groqAvailable()) {
    return res.status(501).json({ error: 'Photo logging needs an AI key on the server (GEMINI_API_KEY or GROQ_API_KEY — both free).' });
  }

  const context = req.body.context || {};
  const ctx = `Daily goal ${context.goal || 2000} cal; ${context.totalToday || 0} cal logged so far today. Local time: ${context.localTime || 'unknown'}.`;

  const warnings = [];
  let items = [];
  let reply = null;
  const providers = [
    { name: 'Gemini', ok: geminiAvailable(), parse: () => geminiParsePhoto(image, mediaType, note, ctx) },
    { name: 'Groq', ok: groqAvailable(), parse: () => groqParsePhoto(image, mediaType, note, ctx) },
  ];
  for (const provider of providers) {
    if (!provider.ok || items.length) continue;
    try {
      const parsed = await provider.parse();
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
      if (!items.length && reply) break; // model looked and found no food — trust it
    } catch (err) {
      console.warn(`${provider.name} photo parse failed: ${err.message}`);
      warnings.push(`${provider.name}: ${err.message.slice(0, 120)}`);
    }
  }

  if (!items.length) {
    return res.json({
      items: [],
      reply: reply || 'I couldn\'t make out the food in that photo — try a bit more light, or tell me what it was in words. 📷',
      warnings: reply ? [] : warnings.slice(0, 2),
    });
  }

  // USDA nutrition for what the photo shows. No image generation here — the
  // client keeps the user's own photo for the journal, which beats anything
  // we could draw.
  const out = [];
  for (const item of items.slice(0, 6)) {
    const nutrition = await resolveNutrition(item);
    out.push({
      name: item.name,
      emoji: item.emoji || '🍽️',
      portion: item.portion || '1 serving',
      image: null,
      ...nutrition,
    });
  }
  res.json({ items: out, reply, warnings: [] });
});

app.post('/api/analyze', async (req, res) => {
  // Access code may arrive as a header or in the body (the body keeps the
  // request preflight-free).
  const key = req.get('X-Morsel-Key') || (req.body && req.body.key);
  if (ACCESS_CODE && key !== ACCESS_CODE) {
    return res.status(401).json({ error: 'Access code required', needsKey: true });
  }

  const text = String(req.body.text || '').trim().slice(0, 500);
  if (!text) return res.status(400).json({ error: 'Tell me what you ate first!' });
  const context = req.body.context || {};

  // 1. Parse — try each AI brain in turn (Gemini, then Groq), so smart
  //    parsing survives one provider's free-tier congestion; the local
  //    parser (~120 foods) is the final, always-available fallback.
  //    `warnings` are user-facing; provider/image hiccups that don't degrade
  //    the result stay in the server log only.
  const warnings = [];
  let items = [];
  let reply = null;
  let aiUsed = false;
  const ctx = `Daily goal ${context.goal || 2000} cal; ${context.totalToday || 0} cal logged so far today.`;
  const providers = [
    { name: 'Gemini', ok: geminiAvailable(), parse: () => geminiParse(text, ctx) },
    { name: 'Groq', ok: groqAvailable(), parse: () => groqParse(text, ctx) },
  ];
  for (const provider of providers) {
    if (!provider.ok || items.length) continue;
    try {
      const parsed = await provider.parse();
      items = parsed.items || [];
      reply = parsed.reply || null;
      if (items.length) aiUsed = true;
      for (const item of items) {
        const known = findFood(item.name);
        if (known) {
          item.usdaQuery = item.usdaQuery || known.usda;
          item.emoji = item.emoji || known.emoji;
          if (!item.grams) item.grams = known.grams;
        }
      }
    } catch (err) {
      // A provider failing is fine as long as the next one (or local) covers it.
      console.warn(`${provider.name} parse failed: ${err.message}`);
    }
  }
  if (!items.length) {
    items = parseLocally(text);
    reply = null;
  }
  if (!items.length) return res.json({ items: [], reply: null, warnings });
  // Only tell the user about parsing trouble when it actually degraded the
  // result — i.e. no AI succeeded and we leaned on the built-in word list.
  if (!aiUsed && (geminiAvailable() || groqAvailable())) {
    warnings.push('The AI was busy, so I used my built-in food list for this one — tap again in a moment for a smarter read.');
  }

  // 2. Nutrition (USDA) + a food image — computed, returned, forgotten.
  //    Image failures fall back to an illustrated plate silently; that's the
  //    chosen experience without billing, not an error worth flagging.
  const out = [];
  for (const item of items.slice(0, 6)) {
    const nutrition = await resolveNutrition(item);
    const image = await makeImage(item);
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
  const parsers = [geminiAvailable() && 'Gemini', groqAvailable() && 'Groq'].filter(Boolean);
  console.log(`\n  🍓 Morsel is ready → http://localhost:${PORT}\n`);
  console.log(`  smart parsing      : ${parsers.length ? parsers.join(' → ') + ' → local' : 'local only (set GEMINI_API_KEY or GROQ_API_KEY)'}`);
  console.log(`  food images        : ${ENABLE_IMAGES && geminiAvailable() ? 'AI photos on (gemini image, needs billing)' : 'illustrated plates (set ENABLE_IMAGES=true for AI photos)'}`);
  console.log(`  USDA FoodData      : ${process.env.USDA_API_KEY ? 'API key set' : 'using DEMO_KEY (set USDA_API_KEY for headroom)'}`);
  console.log(`  access code        : ${ACCESS_CODE ? 'required' : 'open (set ACCESS_CODE to restrict who can use your keys)'}\n`);
});
