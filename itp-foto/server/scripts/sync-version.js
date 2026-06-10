'use strict';

const fs   = require('fs');
const path = require('path');

const pkg         = require('../package.json');
const version     = pkg.version;
const websitePath = path.join(__dirname, '../../../website/index.html');

if (!fs.existsSync(websitePath)) {
  console.error('[sync-version] website/index.html not found at', websitePath);
  process.exit(1);
}

let html = fs.readFileSync(websitePath, 'utf8');
const before = html;

// Înlocuiește "versiunea X.Y.Z disponibilă" cu versiunea curentă
html = html.replace(
  /versiunea \d+\.\d+\.\d+ disponibilă/g,
  `versiunea ${version} disponibilă`
);

if (html === before) {
  console.log(`[sync-version] website deja la versiunea ${version} — nicio modificare.`);
} else {
  fs.writeFileSync(websitePath, html, 'utf8');
  console.log(`[sync-version] website/index.html actualizat → versiunea ${version}`);
}
