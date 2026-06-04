'use strict';

const { Router } = require('express');
const { getDb } = require('../lib/database');

const router = Router();

// GET /api/config — toate setările stației
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT key, value FROM config").all();
    const config = {};
    rows.forEach(r => { config[r.key] = r.value; });
    res.json({ ok: true, config });
  } catch (err) {
    res.status(500).json({ ok: false, eroare: 'Nu s-au putut încărca setările.' });
  }
});

// POST /api/config — actualizează una sau mai multe setări
router.post('/', (req, res) => {
  try {
    const { config } = req.body;
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ ok: false, eroare: 'Formatul setărilor este incorect.' });
    }

    const db = getDb();
    const upsert = db.prepare(
      "INSERT INTO config (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    );

    const updateMany = db.transaction((entries) => {
      for (const [key, value] of entries) {
        upsert.run(key, String(value));
      }
    });

    updateMany(Object.entries(config));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, eroare: 'Nu s-au putut salva setările.' });
  }
});

module.exports = router;
