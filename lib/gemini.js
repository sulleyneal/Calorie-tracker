// Gemini client.
//  - gemini-2.5-flash parses free-text meals and writes Morsel's replies
//  - gemini-2.5-flash-image ("nano banana") generates the food photography
const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const TEXT_MODEL = 'gemini-2.5-flash';
const IMAGE_MODEL = 'gemini-2.5-flash-image';

function geminiAvailable() {
  return Boolean(API_KEY);
}

async function callGemini(model, body, timeoutMs) {
  const res = await fetch(`${BASE}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini ${model} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
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
      "usdaQuery": "croissant almond"    // a short query for the USDA FoodData Central search API
    }
  ],
  "reply": "one warm, concise sentence reacting to the meal — like a supportive friend, never preachy"
}

If the text contains no food at all, return {"items": [], "reply": "a gentle, playful one-line answer to what they said"}.
Honor quantities ("two eggs" → grams/kcal for two). Keep names short. Never invent foods not mentioned.`;

// Parse a meal description. Returns { items, reply } or null on failure.
async function geminiParse(text, context) {
  const data = await callGemini(TEXT_MODEL, {
    system_instruction: { parts: [{ text: PARSE_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: `Context: ${context}\n\nUser said: ${text}` }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
  }, 20000);

  const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.items)) throw new Error('Gemini parse: bad shape');
  return parsed;
}

// Generate a Morsel-style food photo with nano banana. Returns a PNG Buffer or null.
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
  const d = await callGemini(TEXT_MODEL, {
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

module.exports = { geminiAvailable, geminiParse, geminiImage, geminiPingText, geminiPingImage };
