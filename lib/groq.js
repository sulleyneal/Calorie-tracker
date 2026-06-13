// Groq client — a free, fast fallback brain for meal parsing. Groq's free
// tier needs only an API key (no credit card) and has generous limits, so it
// keeps "smart parsing" working when Gemini's free tier is congested.
// OpenAI-compatible Chat Completions API.
const { PARSE_SYSTEM } = require('./gemini');

const API_KEY = process.env.GROQ_API_KEY || '';
const URL = 'https://api.groq.com/openai/v1/chat/completions';
// Solid instruction-follower on Groq's free tier; override with GROQ_MODEL.
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

function groqAvailable() {
  return Boolean(API_KEY);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callGroq(messages, timeoutMs, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
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
      throw new Error(`Groq ${MODEL} ${res.status}: ${text.slice(0, 200)}`);
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

// Live check for /api/selftest.
async function groqPing() {
  const data = await callGroq([{ role: 'user', content: 'Reply with JSON {"ok":true}.' }], 15000);
  return data.choices?.length ? 'ok' : 'no choices returned';
}

module.exports = { groqAvailable, groqParse, groqPing };
