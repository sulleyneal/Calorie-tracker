// Gemini client.
//  - gemini-2.5-flash parses free-text meals and writes Morsel's replies
//  - gemini-2.5-flash-image generates optional AI food photography
const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Primary model first; the -lite model usually has spare capacity when the
// primary returns 503 "high demand".
const TEXT_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const IMAGE_MODEL = 'gemini-2.5-flash-image';

function geminiAvailable() {
  return Boolean(API_KEY);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retries genuine transient congestion (500/503) with backoff. A 429 is a
// hard quota/billing limit that won't clear on a short retry, so it fails
// fast — the caller falls back to an illustrated plate without a long wait.
async function callGemini(model, body, timeoutMs, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return res.json();
    const text = await res.text().catch(() => '');
    const transient = [500, 503].includes(res.status);
    if (!transient || attempt >= retries) {
      throw new Error(`Gemini ${model} ${res.status}: ${text.slice(0, 200)}`);
    }
    await sleep(1500 * (attempt + 1));
  }
}

// Tries each text model in turn (each with its own retries).
async function callTextModel(body, timeoutMs) {
  let lastErr;
  for (const model of TEXT_MODELS) {
    try {
      return await callGemini(model, body, timeoutMs);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

const PARSE_SYSTEM = `You are the food-parsing brain of Morsel, a friendly calorie tracker.
The user describes what they ate in casual language. Extract each distinct food item.

Return ONLY JSON matching this shape:
{
  "items": [
    {
      "name": "Almond Croissant",        // short title-cased display name
      "emoji": "🥐",                      // single best emoji for the food
      "portion": "1 pastry",             // human portion ("medium, 12 oz", "1 cup, sliced")
      "grams": 95,                        // your best estimate of total grams eaten
      "kcal": 410, "p": 8, "c": 42, "f": 24,  // estimated calories & macros for that portion
      "branded": false,                   // true if this is a specific restaurant/brand menu item
      "usdaQuery": "croissant almond"    // USDA FoodData Central search query; "" for branded items
    }
  ],
  "reply": "one warm, concise sentence reacting to the meal — like a supportive friend, never preachy"
}

FAST FOOD & RESTAURANT ITEMS — important:
- If the user names a restaurant or brand (McDonald's, Whataburger, Chick-fil-A,
  Chipotle, Starbucks, Taco Bell, Wendy's, In-N-Out, Subway, etc.), identify the
  SPECIFIC menu item and use that item's real published nutrition for the size given.
- Keep the brand in the name, e.g. "Whataburger Onion Rings (Large)", "Big Mac",
  "Chick-fil-A Spicy Deluxe".
- Treat size words (small / medium / large) as the MENU SIZE of that order, NOT a
  count of pieces. "Large onion rings from Whataburger" = a large ORDER of onion
  rings (~490 cal), not one big ring.
- Set "branded": true and "usdaQuery": "" for these — your menu knowledge is more
  accurate than a generic database lookup.

If the text contains no food at all, return {"items": [], "reply": "a gentle, playful one-line answer to what they said"}.
Honor quantities ("two eggs" → grams/kcal for two). Keep names short. Never invent foods not mentioned.
VOLUME PORTIONS — use realistic cooked densities and multiply exactly:
1 cup cooked rice/pasta ≈ 155-160 g (~205 cal for white rice); 1 cup cooked oatmeal ≈ 234 g;
1 cup raw leafy greens ≈ 30 g. "2.5 cups of rice" = 2.5 × one cup, i.e. ≈ 395 g and ≈ 510 cal — never less.
SINGLE WHOLE FOODS — use standard USDA reference portions, never inflated:
1 medium banana = 118 g ≈ 105 cal (0.4 g fat); 1 medium apple = 182 g ≈ 95 cal;
1 large egg = 50 g (≈72 cal boiled, ≈90 fried); 1 medium orange = 131 g ≈ 62 cal.`;

const PHOTO_SYSTEM = PARSE_SYSTEM + `

PHOTO MODE — the user sent a PHOTO of their meal instead of (or along with) text:
- Identify every distinct food visible on the plate/table that they are eating.
- Judge portions from visual cues: plate diameter, utensils, glass size, packaging.
- If the user added a note, treat it as ground truth over the photo ("half of this",
  "no dressing", "large size").
- Ignore garnish scraps, drinks that are clearly water, and other people's food.
- In "reply", react like a friend who just saw the photo — mention what looks good.`;

// Parse a meal PHOTO (+ optional note). Returns { items, reply }.
async function geminiParsePhoto(imageBase64, mediaType, note, context) {
  const parts = [
    { inline_data: { mime_type: mediaType || 'image/jpeg', data: imageBase64 } },
    { text: `Context: ${context}\n\n${note ? `User's note: ${note}` : 'No note — read the photo.'}` },
  ];
  const data = await callTextModel({
    system_instruction: { parts: [{ text: PHOTO_SYSTEM }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
  }, 30000);

  const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.items)) throw new Error('Gemini photo parse: bad shape');
  return parsed;
}

// Parse a meal description. Returns { items, reply } or null on failure.
async function geminiParse(text, context) {
  const data = await callTextModel({
    system_instruction: { parts: [{ text: PARSE_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: `Context: ${context}\n\nUser said: ${text}` }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
  }, 20000);

  const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.items)) throw new Error('Gemini parse: bad shape');
  return parsed;
}

// Generate a Morsel-style food photo (Gemini image model). Returns a PNG Buffer or null.
async function geminiImage(name, portion) {
  const prompt =
    `Professional minimalist food photography for a wellness app: ${portion} of ${name}, ` +
    `served on simple white ceramic dishware (plate, bowl, or cup — whichever suits the food), ` +
    `centered, photographed from a slightly elevated three-quarter angle, ` +
    `soft diffused studio lighting, gentle shadow beneath the dish, ` +
    `seamless pale blush-pink to cream gradient background, lots of negative space, ` +
    `appetizing, crisp focus, square format. No text, no hands, no props.`;

  const data = await callGemini(IMAGE_MODEL, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  }, 60000);

  for (const part of data.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData?.data) return Buffer.from(part.inlineData.data, 'base64');
  }
  return null;
}

// Minimal live checks used by /api/selftest — returns 'ok' or throws with
// Google's exact rejection message.
async function geminiPingText() {
  const d = await callTextModel({
    contents: [{ role: 'user', parts: [{ text: 'Reply with the word ok.' }] }],
  }, 20000);
  return d.candidates?.length ? 'ok' : 'no candidates returned';
}

async function geminiPingImage() {
  const d = await callGemini(IMAGE_MODEL, {
    contents: [{ role: 'user', parts: [{ text: 'A single red strawberry on a white plate, minimal.' }] }],
  }, 60000);
  const hasImage = (d.candidates?.[0]?.content?.parts || []).some((p) => p.inlineData?.data);
  return hasImage ? 'ok' : 'no image returned';
}

module.exports = { geminiAvailable, geminiParse, geminiParsePhoto, geminiImage, geminiPingText, geminiPingImage, PARSE_SYSTEM, PHOTO_SYSTEM };
