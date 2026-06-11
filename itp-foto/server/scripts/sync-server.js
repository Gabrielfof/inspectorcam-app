'use strict';

/**
 * sync-server.js
 * Actualizează fișierele server din app.asar fără rebuild complet.
 * Extrage asar-ul, copiază src/ din sursă, repachează.
 */

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ASAR_PATH = '/Applications/InspectorCam.app/Contents/Resources/app.asar';
const SRC_DIR   = path.resolve(__dirname, '..', 'src');
const TMP_DIR   = '/tmp/inspectorcam-server-sync';

if (!fs.existsSync(ASAR_PATH)) {
  console.error('[sync-server] InspectorCam.app nu e instalată în /Applications.');
  process.exit(1);
}

console.log('[sync-server] Extrag app.asar…');
if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true });
execSync(`npx --yes @electron/asar extract "${ASAR_PATH}" "${TMP_DIR}"`);

console.log('[sync-server] Copiez src/…');
copyDir(SRC_DIR, path.join(TMP_DIR, 'src'));

console.log('[sync-server] Repachaj app.asar…');
fs.copyFileSync(ASAR_PATH, ASAR_PATH + '.bak');
execSync(`npx @electron/asar pack "${TMP_DIR}" "${ASAR_PATH}"`);

fs.rmSync(TMP_DIR, { recursive: true });
console.log('[sync-server] Gata — repornește InspectorCam pentru a aplica modificările.');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
