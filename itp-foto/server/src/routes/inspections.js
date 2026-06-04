'use strict';

const { Router } = require('express');
const { getDb } = require('../lib/database');

const router = Router();

// GET /api/inspections?date=YYYY-MM-DD — inspecțiile dintr-o zi
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const { date, inspector_id } = req.query;

    let sql = `
      SELECT i.*, insp.name AS inspector_name
      FROM inspections i
      JOIN inspectors insp ON insp.id = i.inspector_id
      WHERE 1=1
    `;
    const params = [];

    if (date) {
      sql += " AND date(i.datetime) = ?";
      params.push(date);
    }
    if (inspector_id) {
      sql += " AND i.inspector_id = ?";
      params.push(inspector_id);
    }

    sql += " ORDER BY i.datetime DESC";

    const inspections = db.prepare(sql).all(...params);

    // Adaugă fotografiile pentru fiecare inspecție
    const photosStmt = db.prepare("SELECT * FROM photos WHERE inspection_id = ? ORDER BY step");
    const result = inspections.map(insp => ({
      ...insp,
      photos: photosStmt.all(insp.id),
    }));

    res.json({ ok: true, inspections: result });
  } catch (err) {
    console.error('[inspections] GET /:', err);
    res.status(500).json({ ok: false, eroare: 'Nu s-au putut încărca inspecțiile.' });
  }
});

// GET /api/inspections/:id — detalii inspecție
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const insp = db.prepare(`
      SELECT i.*, insp.name AS inspector_name
      FROM inspections i
      JOIN inspectors insp ON insp.id = i.inspector_id
      WHERE i.id = ?
    `).get(req.params.id);

    if (!insp) {
      return res.status(404).json({ ok: false, eroare: 'Inspecția nu a fost găsită.' });
    }

    insp.photos = db.prepare("SELECT * FROM photos WHERE inspection_id = ? ORDER BY step").all(insp.id);

    res.json({ ok: true, inspection: insp });
  } catch (err) {
    res.status(500).json({ ok: false, eroare: 'Nu s-au putut încărca detaliile inspecției.' });
  }
});

module.exports = router;
