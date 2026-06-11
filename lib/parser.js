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

function formatPortion(qty, portion) {
  if (qty === 1) return portion;
  const m = portion.match(/^1 (\w+)(.*)$/);
  if (m) {
    const unit = PLURAL[m[1]] || m[1];
    return `${qty} ${unit}${m[2]}`;
  }
  return `${qty} × ${portion}`;
}

function quantityBefore(text, index) {
  // Look at the word(s) immediately before the match: "two", "3", "a couple of"
  const before = text.slice(0, index).trimEnd();
  const m = before.match(/(?:^|\s)(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple|few|half)(?:\s+of)?$/);
  if (!m) return 1;
  const word = m[1];
  if (/^\d/.test(word)) return Math.min(parseFloat(word), 20);
  return NUMBER_WORDS[word] ?? 1;
}

function parseLocally(text) {
  let masked = ' ' + normalize(text) + ' ';
  const items = [];

  for (const { alias, food } of ALIASES) {
    const re = new RegExp(`(?<=\\s)${alias.replace(/\s+/g, '\\s+')}(?:s|es)?(?=\\s)`, 'g');
    let m;
    while ((m = re.exec(masked)) !== null) {
      const qty = quantityBefore(masked, m.index);
      items.push({
        name: titleCase(food.aliases[0]),
        emoji: food.emoji,
        portion: formatPortion(qty, food.portion),
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
  return items.map(({ index, ...item }) => item);
}

function titleCase(s) {
  return s.replace(/\b[a-z]/g, (ch) => ch.toUpperCase())
    .replace(/\bAnd\b/g, 'and').replace(/\bWith\b/g, 'with')
    .replace(/\bBlt\b/g, 'BLT').replace(/\bPb&j\b/gi, 'PB&J');
}

module.exports = { parseLocally, titleCase };
