'use strict';

const fs = require('fs');
const path = require('path');
const { getDb } = require('./database');

/**
 * Returnează folderul rădăcină din configurație.
 */
function getRootFolder() {
  const db = getDb();
  const row = db.prepare("SELECT value FROM config WHERE key = 'save_folder'").get();
  const defaultPath = process.platform === 'win32'
    ? 'C:\\InspectorCam'
    : path.join(process.env.HOME || '', 'InspectorCam');
  return (row && row.value) ? row.value : defaultPath;
}

const MONTHS_RO = [
  'Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie',
  'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie',
];

/**
 * Construiește și creează folderul inspecției.
 * Format: <root>/<AN>/<Luna>/<Ziua>/<numar-inmatriculare>/
 *
 * @param {string} plate - Numărul de înmatriculare
 * @param {Date}   date  - Data inspecției
 * @returns {string}     - Calea absolută a folderului plăcii
 */
function createInspectionFolder(plate, date) {
  const root      = getRootFolder();
  const year      = date.getFullYear().toString();
  const monthName = MONTHS_RO[date.getMonth()];
  const day       = date.getDate().toString();

  const safePlate  = plate.replace(/\s+/g, '-').replace(/[^A-Za-z0-9\-]/g, '');
  const folderPath = path.join(root, year, monthName, day, safePlate);
  fs.mkdirSync(folderPath, { recursive: true });
  return folderPath;
}

/**
 * Determină următorul număr secvențial disponibil pentru un număr de înmatriculare în folderul zilei.
 * Scanează fișierele existente de forma <plate>_NNN.jpg
 *
 * @param {string} dayFolder - Calea folderului zilei
 * @param {string} plate     - Numărul de înmatriculare
 * @returns {number}         - Primul număr secvențial disponibil (pornind de la 1)
 */
function getNextPhotoNumber(dayFolder, plate) {
  const safePlate = plate.replace(/\s+/g, '-').replace(/[^A-Za-z0-9\-]/g, '');
  const prefix = safePlate + '_';

  if (!fs.existsSync(dayFolder)) return 1;

  const existing = fs.readdirSync(dayFolder)
    .filter(f => f.startsWith(prefix) && /\.(jpg|jpeg|png)$/i.test(f))
    .map(f => {
      const base = f.slice(prefix.length);
      const num = parseInt(base.split('.')[0], 10);
      return isNaN(num) ? 0 : num;
    })
    .filter(n => n > 0);

  return existing.length > 0 ? Math.max(...existing) + 1 : 1;
}

/**
 * Generează numele fișierului pentru o fotografie.
 * Format: <plate>_NNN.jpg
 *
 * @param {string} plate  - Numărul de înmatriculare
 * @param {number} seqNum - Numărul secvențial
 * @returns {string}
 */
function getPhotoFilename(plate, seqNum) {
  const safePlate = plate.replace(/\s+/g, '-').replace(/[^A-Za-z0-9\-]/g, '');
  return `${safePlate}_${String(seqNum).padStart(3, '0')}.jpg`;
}

/**
 * Scrie fișierul metadata.json în folderul inspecției.
 *
 * @param {string} folderPath - Calea folderului
 * @param {object} metadata   - Obiectul de metadate
 */
function writeMetadata(folderPath, metadata) {
  const filePath = path.join(folderPath, '.metadata.json');
  // Append-mode: citim fișierul existent (dacă există) și adăugăm inspecția
  let existing = [];
  if (fs.existsSync(filePath)) {
    try { existing = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}
    if (!Array.isArray(existing)) existing = [existing];
  }
  existing.push(metadata);
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf8');
}

/**
 * Returnează calea destinație a unui fișier foto.
 *
 * @param {string} folderPath - Calea folderului
 * @param {string} filename   - Numele fișierului
 * @returns {string}
 */
function getPhotoPath(folderPath, filename) {
  return path.join(folderPath, filename);
}

/**
 * Listează inspecțiile (foldere) dintr-o zi specifică.
 *
 * @param {string} dateStr - Format "YYYY-MM-DD"
 * @returns {string[]}     - Lista de căi absolute
 */
function listFoldersForDate(dateStr) {
  const dayPath = path.join(getRootFolder(), dateStr);
  if (!fs.existsSync(dayPath)) return [];
  return [dayPath];
}

module.exports = {
  createInspectionFolder,
  getNextPhotoNumber,
  getPhotoFilename,
  writeMetadata,
  getPhotoPath,
  listFoldersForDate,
  getRootFolder,
};
