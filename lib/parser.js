// Offline free-text meal parser. Scans the whole sentence for known foods,
// longest alias first, so "almond croissant" beats "croissant" and
// "oatmeal with blueberries" beats both "oatmeal" and "blueberries".
const { FOODS, NUMBER_WORDS, normalize } = require('./foods');

// Pre-build (alias, food) pairs sorted by alias length, longest first.
const ALIASES = FOODS
  .flatMap((food) => food.aliases.map((alias) => ({ alias, food })))
  .sort((a, b) => b.alias.length - a.alias.length);

// Unit words we can safely pluralize when showing "3 cups" etc.
const PLURAL = {
  cup: 'cups', slice: 'slices', bowl: 'bowls', plate: 'plates', pastry: 'pastries',
  muffin: 'muffins', bar: 'bars', square: 'squares', stick: 'sticks', link: 'links',
  piece: 'pieces', taco: 'tacos', sandwich: 'sandwiches', burger: 'burgers',
  burrito: 'burritos', wrap: 'wraps', donut: 'donuts', cookie: 'cookies',
  egg: 'eggs', shot: 'shots', glass: 'glasses', scoop: 'scoops', can: 'cans',
  bagel: 'bagels', chop: 'chops', wing: 'wings', serving: 'servings',
};

const UNITS = 'slices?|cups?|pieces?|eggs?|bars?|scoops?|links?|glasses?|cans?|servings?|bowls?|shots?|wings?|tacos?|cookies?|strips?|patties';
const numOf = (w) => (/^\d/.test(w) ? Math.min(parseFloat(w), 20) : (NUMBER_WORDS[w] ?? 1));
const sameUnit = (a, b) => a.slice(0, 3) === b.slice(0, 3);
const SINGULAR = {
  slices: 'slice', cups: 'cup', pieces: 'piece', eggs: 'egg', bars: 'bar',
  scoops: 'scoop', links: 'link', glasses: 'glass', cans: 'can', servings: 'serving',
  bowls: 'bowl', shots: 'shot', wings: 'wing', tacos: 'taco', cookies: 'cookie',
  strips: 'strip', patties: 'patty',
};
function unitLabel(unit, count) {
  const sing = SINGULAR[unit] || unit.replace(/s$/, '');
  return count === 1 ? sing : (PLURAL[sing] || `${sing}s`);
}

// A stated quantity before the food ("two eggs", "3 slices of pizza").
function quantityBefore(text, index) {
  const before = text.slice(0, index).trimEnd();
  let m = before.match(new RegExp(`(?:^|\\s)(\\d+(?:\\.\\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple|few|half)\\s+(${UNITS})(?:\\s+of)?$`));
  if (m) return { count: numOf(m[1]), unit: m[2] };
  m = before.match(/(?:^|\s)(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple|few|half)(?:\s+of)?$/);
  if (m) return { count: numOf(m[1]), unit: null };
  return null;
}

// A count stated right after the food ("the toast was 2 slices", "pizza x3").
function quantityAfter(text, endIndex) {
  const after = text.slice(endIndex);
  const m = after.match(new RegExp(`^\\s*(?:was|were|is|are|x|×)?\\s*[:,]?\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNITS}|of)?\\b`));
  if (!m || (!m[2] && !/^\s*(?:was|were|is|are|x|×)/.test(after))) return null;
  // "the bagel was 400 calories" — that number is a calorie figure, not a
  // portion count; leave it to the explicit-calorie override below.
  if (/^\s*(?:k?cals?|calories?)\b/.test(after.slice(m[0].length))) return null;
  return { count: Math.min(parseFloat(m[1]), 20), unit: m[2] && m[2] !== 'of' ? m[2] : null };
}

// Turn a stated {count, unit} into a serving multiplier + display portion,
// reconciling the unit against the food's canonical portion. "3 slices" of a
// food whose base is "2 slices" means 3 slices (×1.5), not 3 servings (×3).
function resolveQuantity(q, portion) {
  if (!q) return { qty: 1, label: portion };
  const base = portion.match(/^(\d+(?:\.\d+)?)\s+([a-z]+)(.*)$/);
  if (q.unit && base && sameUnit(q.unit, base[2])) {
    const baseCount = parseFloat(base[1]) || 1;
    return { qty: q.count / baseCount, label: `${+q.count.toFixed(2)} ${unitLabel(q.unit, q.count)}${base[3]}` };
  }
  return { qty: q.count, label: formatPortion(q.count, portion) };
}

function formatPortion(qty, portion) {
  if (qty === 1) return portion;
  const m = portion.match(/^1 (\w+)(.*)$/);
  if (m) {
    const unit = PLURAL[m[1]] || m[1];
    return `${+qty.toFixed(2)} ${unit}${m[2]}`;
  }
  return `${+qty.toFixed(2)} × ${portion}`;
}

function parseLocally(text) {
  let masked = ' ' + normalize(text) + ' ';
  const items = [];

  for (const { alias, food } of ALIASES) {
    const re = new RegExp(`(?<=\\s)${alias.replace(/\s+/g, '\\s+')}(?:s|es)?(?=\\s)`, 'g');
    let m;
    while ((m = re.exec(masked)) !== null) {
      const stated = quantityBefore(masked, m.index) || quantityAfter(masked, m.index + m[0].length);
      const { qty, label } = resolveQuantity(stated, food.portion);
      items.push({
        name: titleCase(food.aliases[0]),
        emoji: food.emoji,
        portion: label,
        grams: Math.round(food.grams * qty),
        kcal: Math.round(food.kcal * qty),
        p: Math.round(food.p * qty),
        c: Math.round(food.c * qty),
        f: Math.round(food.f * qty),
        usdaQuery: food.usda,
        index: m.index,
      });
      // Mask the matched span so shorter aliases can't re-match it.
      masked = masked.slice(0, m.index) + '#'.repeat(m[0].length) + masked.slice(m.index + m[0].length);
    }
  }

  // Present items in the order they were spoken.
  items.sort((a, b) => a.index - b.index);
  const out = items.map(({ index, ...item }) => item);

  // Honor an explicit calorie count — "protein bar, about 200 calories"
  // means 200, not our table's default. Macros scale along.
  const stated = normalize(text).match(/(\d{2,4})\s*(?:k?cals?|calories?)\b/);
  if (stated && out.length === 1) {
    const kcal = parseInt(stated[1], 10);
    if (kcal >= 10 && kcal <= 5000) {
      const it = out[0];
      const k = it.kcal > 0 ? kcal / it.kcal : 0;
      it.kcal = kcal;
      it.p = Math.round(it.p * k);
      it.c = Math.round(it.c * k);
      it.f = Math.round(it.f * k);
      it.usdaQuery = '';
      it.userStated = true;
    }
  }
  return out;
}

function titleCase(s) {
  return s.replace(/\b[a-z]/g, (ch) => ch.toUpperCase())
    .replace(/\bAnd\b/g, 'and').replace(/\bWith\b/g, 'with')
    .replace(/\bBlt\b/g, 'BLT').replace(/\bPb&j\b/gi, 'PB&J').replace(/\bNy\b/g, 'NY');
}

module.exports = { parseLocally, titleCase };
