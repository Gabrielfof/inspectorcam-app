'use strict';

const fs   = require('fs');
const path = require('path');

const pwaPath = path.resolve(__dirname, '..', '..', 'pwa');
const outFile = path.join(__dirname, '..', 'src', 'pwa-source-path.json');

fs.writeFileSync(outFile, JSON.stringify({ path: pwaPath }, null, 2));
console.log('[prebuild] pwa-source-path.json scris:', pwaPath);
