// When nano banana isn't available (no GEMINI_API_KEY or offline), every food
// still gets a sweet little illustrated plate: soft blush gradient, white
// ceramic dish with a rim highlight, and the food's emoji as the hero.
const PALETTES = [
  ['#fff7f4', '#ffe0dc'],
  ['#fff9f2', '#ffe5d0'],
  ['#f8fbf5', '#dff0d8'],
  ['#f5f9fc', '#d8e8f5'],
  ['#fdf6fb', '#f4d9ee'],
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
    <radialGradient id="bg" cx="50%" cy="32%" r="85%">
      <stop offset="0%" stop-color="${light}"/>
      <stop offset="100%" stop-color="${blush}"/>
    </radialGradient>
    <linearGradient id="plate" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#ece4e1"/>
    </linearGradient>
    <radialGradient id="shadow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#b98d8a" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#b98d8a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.75"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="400" height="400" fill="url(#bg)"/>
  <ellipse cx="200" cy="226" rx="160" ry="120" fill="url(#glow)"/>
  <ellipse cx="200" cy="306" rx="155" ry="36" fill="url(#shadow)"/>
  <ellipse cx="200" cy="284" rx="148" ry="44" fill="url(#plate)"/>
  <ellipse cx="200" cy="280" rx="146" ry="42" fill="#ffffff"/>
  <ellipse cx="200" cy="278" rx="118" ry="32" fill="#f3edeb"/>
  <ellipse cx="200" cy="276" rx="114" ry="30" fill="#fbf8f7"/>
  <text x="200" y="252" font-size="150" text-anchor="middle" dominant-baseline="middle">${emoji}</text>
</svg>`;
}

module.exports = { placeholderSvg };
