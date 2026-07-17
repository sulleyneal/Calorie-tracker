// Groq client — a free, fast fallback brain for meal parsing. Groq's free
// tier needs only an API key (no credit card) and has generous limits, so it
// keeps "smart parsing" working when Gemini's free tier is congested.
// OpenAI-compatible Chat Completions API.
const { PARSE_SYSTEM, PHOTO_SYSTEM } = require('./gemini');

const API_KEY = process.env.GROQ_API_KEY || '';
const URL = 'https://api.groq.com/openai/v1/chat/completions';
// Solid instruction-follower on Groq's free tier; override with GROQ_MODEL.
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
// Vision-capable model on Groq's free tier, for photo logging fallback.
const VISION_MODEL = process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';

function groqAvailable() {
  return Boolean(API_KEY);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callGroq(messages, timeoutMs, retries = 2, model = MODEL) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.4,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return res.json();
    const text = await res.text().catch(() => '');
    const transient = [429, 500, 502, 503].includes(res.status);
    if (!transient || attempt >= retries) {
      throw new Error(`Groq ${model} ${res.status}: ${text.slice(0, 200)}`);
    }
    await sleep(1200 * (attempt + 1));
  }
}

// Parse a meal description. Returns { items, reply }.
async function groqParse(text, context) {
  const data = await callGroq([
    { role: 'system', content: PARSE_SYSTEM },
    { role: 'user', content: `Context: ${context}\n\nUser said: ${text}` },
  ], 20000);

  const raw = data.choices?.[0]?.message?.content || '';
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.items)) throw new Error('Groq parse: bad shape');
  return parsed;
}

// Parse a meal PHOTO (+ optional note) with Groq's free vision model.
// Returns { items, reply }.
async function groqParsePhoto(imageBase64, mediaType, note, context) {
  const data = await callGroq([
    { role: 'system', content: PHOTO_SYSTEM },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mediaType || 'image/jpeg'};base64,${imageBase64}` } },
        { type: 'text', text: `Context: ${context}\n\n${note ? `User's note: ${note}` : 'No note — read the photo.'}` },
      ],
    },
  ], 30000, 2, VISION_MODEL);

  const raw = data.choices?.[0]?.message?.content || '';
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.items)) throw new Error('Groq photo parse: bad shape');
  return parsed;
}

// Live check for /api/selftest.
async function groqPing() {
  const data = await callGroq([{ role: 'user', content: 'Reply with JSON {"ok":true}.' }], 15000);
  return data.choices?.length ? 'ok' : 'no choices returned';
}

module.exports = { groqAvailable, groqParse, groqParsePhoto, groqPing };
