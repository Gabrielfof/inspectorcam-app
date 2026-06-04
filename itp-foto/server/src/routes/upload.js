'use strict';

const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../lib/database');
const { createInspectionFolder, getNextPhotoNumber, getPhotoFilename, writeMetadata, getPhotoPath } = require('../lib/folderManager');

const router = Router();

// Multer: stocare în memorie — fișierele vin în req.files ca Buffer
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20 MB per fișier
    files: 10,
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Doar fișiere imagine sunt acceptate.'));
    }
    cb(null, true);
  },
});

// POST /api/inspections
// Body (multipart/form-data):
//   plate          - numărul de înmatriculare
//   inspector_id   - UUID inspector
//   datetime       - ISO 8601 (opțional, default = now)
//   notes          - observații generale (text)
//   device_id      - ID dispozitiv telefon
//   app_version    - versiune PWA
//   photos[0][step], photos[0][note], photos[0][source], photos[0][ocr_plate] - metadate per fotografie
//   files[]        - fișierele imagine, în aceeași ordine cu photos[]
router.post('/', upload.array('files'), (req, res) => {
  const db = getDb();

  try {
    const { plate, inspector_id, datetime, notes, device_id, app_version } = req.body;

    if (!plate || !plate.trim()) {
      return res.status(400).json({ ok: false, eroare: 'Numărul de înmatriculare este obligatoriu.' });
    }
    if (!inspector_id) {
      return res.status(400).json({ ok: false, eroare: 'Inspectorul este obligatoriu.' });
    }

    const inspector = db.prepare("SELECT id, name FROM inspectors WHERE id = ? AND active = 1").get(inspector_id);
    if (!inspector) {
      return res.status(400).json({ ok: false, eroare: 'Inspectorul nu există sau este inactiv.' });
    }

    const configRows = db.prepare("SELECT key, value FROM config").all();
    const config = {};
    configRows.forEach(r => { config[r.key] = r.value; });

    const inspDate = datetime ? new Date(datetime) : new Date();
    const folderPath = createInspectionFolder(plate.trim(), inspDate);

    // Parseaza metadatele fotografiilor trimise ca JSON în câmpul "photos_meta"
    let photosMeta = [];
    try {
      photosMeta = req.body.photos_meta ? JSON.parse(req.body.photos_meta) : [];
    } catch {
      // Dacă nu vine JSON valid, continuăm fără metadate per fotografie
    }

    const files = req.files || [];
    const savedPhotos = [];

    // Numărotare secvențială per număr de înmatriculare în folderul zilei
    let nextSeq = getNextPhotoNumber(folderPath, plate.trim());

    files.forEach((file, index) => {
      const meta = photosMeta[index] || {};
      const step = meta.step || String(index + 1).padStart(2, '0');
      const filename = getPhotoFilename(plate.trim(), nextSeq + index);
      const destPath = getPhotoPath(folderPath, filename);

      fs.writeFileSync(destPath, file.buffer);

      savedPhotos.push({
        id: uuidv4(),
        step,
        filename,
        note: meta.note || null,
        source: meta.source || 'camera',
        ocr_plate: meta.ocr_plate || null,
        timestamp: meta.timestamp || inspDate.toISOString(),
      });
    });

    const inspectionId = uuidv4();

    const metadata = {
      id: inspectionId,
      plate: plate.trim(),
      datetime: inspDate.toISOString(),
      inspector: { name: inspector.name, id: inspector.id },
      station: {
        name: config.station_name || 'Stația ITP',
        rar_code: config.station_rar_code || '',
      },
      photos: savedPhotos.map(p => ({
        step: p.step,
        filename: p.filename,
        ocr_detected_plate: p.ocr_plate,
        timestamp: p.timestamp,
        note: p.note || '',
        source: p.source,
      })),
      notes: notes || '',
      device_id: device_id || '',
      app_version: app_version || '1.0.0',
    };

    writeMetadata(folderPath, metadata);

    // Salvare în baza de date (transaction atomică)
    const insertInspection = db.prepare(`
      INSERT INTO inspections (id, plate, inspector_id, folder_path, datetime, notes, device_id, app_version, synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const insertPhoto = db.prepare(`
      INSERT INTO photos (id, inspection_id, step, filename, note, source, ocr_plate, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      insertInspection.run(
        inspectionId, plate.trim(), inspector_id, folderPath,
        inspDate.toISOString(), notes || null, device_id || null, app_version || null
      );
      for (const p of savedPhotos) {
        insertPhoto.run(p.id, inspectionId, p.step, p.filename, p.note, p.source, p.ocr_plate, p.timestamp);
      }
    })();

    res.status(201).json({
      ok: true,
      inspection: {
        id: inspectionId,
        folder_path: folderPath,
        plate: plate.trim(),
        photos_saved: savedPhotos.length,
      },
    });
  } catch (err) {
    console.error('[upload] POST /api/inspections:', err);
    res.status(500).json({ ok: false, eroare: 'Eroare la salvarea inspecției. Verificați spațiul pe disc.' });
  }
});

module.exports = router;
