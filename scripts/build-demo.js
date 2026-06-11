// Builds dist/morsel.html — the whole client in a single file (the same one
// GitHub Pages serves). The client owns all data in the browser; when a
// Morsel brain server is configured (?api=https://...), it gains Gemini
// parsing, live USDA nutrition, and nano banana photos.
const fs = require('fs');
const path = require('path');
const { browserEngine } = require('../lib/bundle');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const css = read('public/app.css');
const html = read('public/index.html');
const body = html.match(/<body>([\s\S]*?)<script src="engine\.js">/)[1];
const appJs = read('public/app.js');

const out = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#fbf4f0" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="Morsel" />
<title>Morsel — a delightful calorie tracker</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🍓</text></svg>" />
<link rel="apple-touch-icon" href="icon.png" />
<link rel="manifest" href="manifest.webmanifest" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..700&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<style>
${css}
</style>
</head>
<body>${body}<script>
${browserEngine()}
${appJs}
</script>
</body>
</html>
`;

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', 'morsel.html'), out);
fs.copyFileSync(path.join(ROOT, 'public', 'icon.png'), path.join(ROOT, 'dist', 'icon.png'));
fs.copyFileSync(path.join(ROOT, 'public', 'manifest.webmanifest'), path.join(ROOT, 'dist', 'manifest.webmanifest'));
console.log(`dist/morsel.html — ${(out.length / 1024).toFixed(0)} KB (+ icon.png, manifest.webmanifest)`);
