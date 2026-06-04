'use strict';

/**
 * sync-pwa.js
 * Copiază fișierele PWA din sursă în bundle-ul aplicației instalate.
 *
 * Utilizare:
 *   node scripts/sync-pwa.js           → copiere o singură dată
 *   node scripts/sync-pwa.js --watch   → urmărește modificări și copiază automat
 */

const fs   = require('fs');
const path = require('path');

const SRC  = path.resolve(__dirname, '..', '..', 'pwa');
const DEST = '/Applications/InspectorCam.app/Contents/Resources/pwa';

function timestamp() {
  return new Date().toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function syncAll() {
  if (!fs.existsSync(DEST)) {
    console.error('[sync-pwa] EROARE: bundle-ul nu există la:', DEST);
    console.error('[sync-pwa] Asigurați-vă că InspectorCam este instalat în /Applications/');
    process.exit(1);
  }

  const files = fs.readdirSync(SRC, { withFileTypes: true })
    .filter(e => e.isFile())
    .map(e => e.name);

  for (const file of files) {
    fs.copyFileSync(path.join(SRC, file), path.join(DEST, file));
  }

  console.log(`[sync-pwa] ${timestamp()} — ${files.length} fișiere sincronizate → ${DEST}`);
}

function syncFile(filePath) {
  const filename = path.basename(filePath);
  const dest = path.join(DEST, filename);
  if (!fs.existsSync(DEST)) return;
  fs.copyFileSync(filePath, dest);
  console.log(`[sync-pwa] ${timestamp()} — ${filename} actualizat`);
}

// Copiere inițială
syncAll();

if (process.argv.includes('--watch')) {
  const chokidar = require('chokidar');

  console.log('[sync-pwa] Urmăresc modificări în', SRC);
  console.log('[sync-pwa] Ctrl+C pentru oprire.\n');

  chokidar.watch(path.join(SRC, '*.{js,css,html,json}'), {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  }).on('change', syncFile).on('add', syncFile);
}
