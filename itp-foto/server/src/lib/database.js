'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db = null;

function getDbPath() {
  const dataDir = process.env.ITP_DATA_DIR || path.join(process.env.APPDATA || process.env.HOME, 'InspectorCam');
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, 'inspectorcam.db');
}

function getDb() {
  if (!db) {
    db = new Database(getDbPath());
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inspectors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      pin TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS inspections (
      id TEXT PRIMARY KEY,
      plate TEXT NOT NULL,
      inspector_id TEXT NOT NULL REFERENCES inspectors(id),
      folder_path TEXT NOT NULL,
      datetime TEXT NOT NULL,
      notes TEXT,
      device_id TEXT,
      app_version TEXT,
      synced INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (inspector_id) REFERENCES inspectors(id)
    );

    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      inspection_id TEXT NOT NULL REFERENCES inspections(id),
      step TEXT NOT NULL,
      filename TEXT NOT NULL,
      note TEXT,
      source TEXT NOT NULL DEFAULT 'camera',
      ocr_plate TEXT,
      timestamp TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO config (key, value) VALUES
      ('station_name', 'Stația ITP'),
      ('station_rar_code', ''),
      ('station_address', ''),
      ('save_folder', '${process.platform === 'win32' ? 'C:\\\\InspectorCam' : path.join(process.env.HOME || '', 'InspectorCam')}'),
      ('backup_folder', ''),
      ('backup_hour', '23'),
      ('enable_motor_photo', '1'),
      ('enable_interior_photo', '1');
  `);
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb };
