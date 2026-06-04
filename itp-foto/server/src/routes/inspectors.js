'use strict';

const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../lib/database');

const router = Router();

// GET /api/inspectors — lista tuturor inspectorilor activi
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT id, name, active, created_at FROM inspectors WHERE active = 1 ORDER BY name").all();
    res.json({ ok: true, inspectors: rows });
  } catch (err) {
    res.status(500).json({ ok: false, eroare: 'Nu s-au putut încărca inspectorii.' });
  }
});

// POST /api/inspectors — adaugă inspector nou
router.post('/', (req, res) => {
  try {
    const { name, pin } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ ok: false, eroare: 'Numele inspectorului este obligatoriu.' });
    }

    const db = getDb();
    const id = uuidv4();
    db.prepare("INSERT INTO inspectors (id, name, pin) VALUES (?, ?, ?)").run(id, name.trim(), pin || null);

    res.status(201).json({ ok: true, inspector: { id, name: name.trim() } });
  } catch (err) {
    res.status(500).json({ ok: false, eroare: 'Nu s-a putut adăuga inspectorul.' });
  }
});

// PUT /api/inspectors/:id — actualizează inspector
router.put('/:id', (req, res) => {
  try {
    const { name, pin, active } = req.body;
    const db = getDb();

    const existing = db.prepare("SELECT id FROM inspectors WHERE id = ?").get(req.params.id);
    if (!existing) {
      return res.status(404).json({ ok: false, eroare: 'Inspectorul nu a fost găsit.' });
    }

    db.prepare("UPDATE inspectors SET name = COALESCE(?, name), pin = COALESCE(?, pin), active = COALESCE(?, active) WHERE id = ?")
      .run(name || null, pin !== undefined ? pin : null, active !== undefined ? (active ? 1 : 0) : null, req.params.id);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, eroare: 'Nu s-a putut actualiza inspectorul.' });
  }
});

// DELETE /api/inspectors/:id — dezactivează (soft delete) inspector
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare("UPDATE inspectors SET active = 0 WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, eroare: 'Nu s-a putut șterge inspectorul.' });
  }
});

// POST /api/inspectors/verify-pin — verifică PIN la login
router.post('/verify-pin', (req, res) => {
  try {
    const { inspector_id, pin } = req.body;
    const db = getDb();
    const row = db.prepare("SELECT id, name, pin FROM inspectors WHERE id = ? AND active = 1").get(inspector_id);

    if (!row) {
      return res.status(404).json({ ok: false, eroare: 'Inspectorul nu a fost găsit.' });
    }

    // Dacă inspectorul nu are PIN setat, orice pin e acceptat
    if (row.pin && row.pin !== pin) {
      return res.status(401).json({ ok: false, eroare: 'PIN incorect.' });
    }

    res.json({ ok: true, inspector: { id: row.id, name: row.name } });
  } catch (err) {
    res.status(500).json({ ok: false, eroare: 'Eroare la verificarea PIN-ului.' });
  }
});

module.exports = router;
