// USDA FoodData Central client — the source of truth for calories & macros.
// https://fdc.nal.usda.gov/api-guide
const API_KEY = process.env.USDA_API_KEY || 'DEMO_KEY';
const BASE = 'https://api.nal.usda.gov/fdc/v1';

const cache = new Map();

// Nutrient numbers per USDA: 208 = Energy (kcal), 203 = Protein,
// 205 = Carbohydrate by difference, 204 = Total lipid (fat).
const NUTRIENTS = { energy: '208', protein: '203', carbs: '205', fat: '204' };

function nutrientValue(food, number) {
  const n = (food.foodNutrients || []).find(
    (x) => x.nutrientNumber === number || String(x.nutrientId) === number
  );
  return n ? n.value : null;
}

// Returns per-100g macros for the best USDA match, or null.
async function usdaLookup(query) {
  const key = query.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const url = `${BASE}/foods/search?api_key=${encodeURIComponent(API_KEY)}` +
    `&query=${encodeURIComponent(query)}` +
    `&dataType=${encodeURIComponent('Survey (FNDDS),SR Legacy,Foundation')}` +
    `&pageSize=5`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`USDA ${res.status}`);
    const data = await res.json();
    const foods = data.foods || [];

    // Pick the result that best matches the query, not merely the first with
    // energy data — "egg whole cooked" must not resolve to "Egg, white only,
    // raw" (52 kcal/100g, 0 fat), which silently guts common foods.
    const qTokens = key.split(/\s+/).filter(Boolean);
    const SUSPECT = ['white only', 'yolk only', 'dried', 'powder', 'baby'];
    const candidates = foods
      .filter((f) => nutrientValue(f, NUTRIENTS.energy) != null)
      .map((f, i) => {
        const desc = (f.description || '').toLowerCase();
        let score = -i * 0.1; // respect USDA's own ranking as a tiebreaker
        for (const t of qTokens) if (desc.includes(t)) score += 1;
        for (const s of SUSPECT) {
          if (desc.includes(s) && !key.includes(s.split(' ')[0])) score -= 3;
        }
        return { f, score };
      })
      .sort((a, b) => b.score - a.score);
    const match = candidates[0]?.f;
    if (!match) { cache.set(key, null); return null; }

    const per100g = {
      kcal: nutrientValue(match, NUTRIENTS.energy) || 0,
      p: nutrientValue(match, NUTRIENTS.protein) || 0,
      c: nutrientValue(match, NUTRIENTS.carbs) || 0,
      f: nutrientValue(match, NUTRIENTS.fat) || 0,
      description: match.description,
      fdcId: match.fdcId,
    };
    cache.set(key, per100g);
    return per100g;
  } catch (err) {
    console.warn(`USDA lookup failed for "${query}": ${err.message}`);
    return null;
  }
}

// Scale per-100g values to a portion in grams.
function scalePortion(per100g, grams) {
  const k = grams / 100;
  return {
    kcal: Math.round(per100g.kcal * k),
    p: Math.round(per100g.p * k),
    c: Math.round(per100g.c * k),
    f: Math.round(per100g.f * k),
  };
}

module.exports = { usdaLookup, scalePortion };
