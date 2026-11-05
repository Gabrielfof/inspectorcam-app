'use strict';

const { Router } = require('express');
const fs   = require('fs');
const path = require('path');
const { getDataDir } = require('../lib/database');

const router = Router();

const MAX_BYTES  = 2 * 1024 * 1024;   // peste 2 MB → jurnalul vechi devine .1
const MAX_EVENTS = 300;

function logPath() {
  return path.join(getDataDir(), 'jurnal-telefoane.log');
}

const short = (v, n) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').slice(0, n);

// POST /api/client-log — evenimente de diagnostic de la telefoane
// Body: { device, ua, standalone, screen, net, events: [{ t, e, d }] }
router.post('/', (req, res) => {
  try {
    const b = req.body || {};
    const events = Array.isArray(b.events) ? b.events.slice(-MAX_EVENTS) : [];
    if (!events.length) return res.json({ ok: true });

    const who = [
      short(b.device, 24),
      b.standalone ? 'iconita' : 'browser',
      short(b.screen, 12),
      b.net ? short(b.net, 8) : '',
      short(b.ua, 160),
    ].join(' | ');
    const lines = events.map(ev =>
      `${short(ev && ev.t, 30)} | ${short(ev && ev.e, 40)} | ${short(ev && ev.d ? JSON.stringify(ev.d) : '', 300)} | ${who}`
    ).join('\n') + '\n';

    const file = logPath();
    try {
      if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, file + '.1');
    } catch { /* fișierul nu există încă */ }
    fs.appendFileSync(file, lines);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, eroare: 'Jurnalul nu a putut fi salvat.' });
  }
});

module.exports = router;
module.exports.logPath = logPath;
