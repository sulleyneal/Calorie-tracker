// Concatenates the lib modules into a single browser-ready script.
// Used by the server (/engine.js) and by scripts/build-demo.js.
const fs = require('fs');
const path = require('path');

const FILES = ['foods.js', 'parser.js', 'placeholder.js'];

function browserEngine() {
  return FILES
    .map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8'))
    .join('\n')
    .replace(/^const .*= require\(.*\);\s*$/gm, '')
    .replace(/^module\.exports = .*$/gm, '');
}

module.exports = { browserEngine };
