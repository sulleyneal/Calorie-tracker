// When nano banana isn't available (no GEMINI_API_KEY or offline), every food
// still gets a sweet little illustrated plate: soft blush gradient, white
// ceramic dish, and the food's emoji as the hero.
const PALETTES = [
  ['#fff7f4', '#ffe3e0'],
  ['#fff9f2', '#ffe8d6'],
  ['#f8fbf5', '#e3f2dd'],
  ['#f5f9fc', '#ddeaf6'],
  ['#fdf6fb', '#f6def0'],
];

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function placeholderSvg(name, emoji) {
  const [light, blush] = PALETTES[hashCode(name) % PALETTES.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="80%">
      <stop offset="0%" stop-color="${light}"/>
      <stop offset="100%" stop-color="${blush}"/>
    </radialGradient>
    <linearGradient id="plate" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#f1ece9"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" fill="url(#bg)"/>
  <ellipse cx="200" cy="295" rx="150" ry="34" fill="#d8b8b2" opacity="0.35"/>
  <ellipse cx="200" cy="282" rx="148" ry="44" fill="url(#plate)"/>
  <ellipse cx="200" cy="276" rx="118" ry="33" fill="#ffffff"/>
  <ellipse cx="200" cy="274" rx="116" ry="31" fill="#faf7f5"/>
  <text x="200" y="252" font-size="150" text-anchor="middle" dominant-baseline="middle">${emoji}</text>
</svg>`;
}

module.exports = { placeholderSvg };
