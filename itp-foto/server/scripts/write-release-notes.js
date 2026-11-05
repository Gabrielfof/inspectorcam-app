'use strict';

// Scrie notele versiunii curente (din src/electron/release-notes.json) în
// build-resources/release-notes.md — electron-builder le pune în release-ul GitHub,
// iar fereastra de actualizare a clienților le afișează înainte de repornire.
const fs   = require('fs');
const path = require('path');

const root    = path.join(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const notes   = JSON.parse(fs.readFileSync(path.join(root, 'src', 'electron', 'release-notes.json'), 'utf8'))[version] || [];

const out = path.join(root, 'build-resources', 'release-notes.md');
fs.writeFileSync(out, notes.map(n => `- ${n}`).join('\n') + (notes.length ? '\n' : ''));
console.log(`[release-notes] v${version}: ${notes.length} puncte → ${path.relative(root, out)}`);
