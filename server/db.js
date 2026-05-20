const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'infinicam.db');

let db;

function initDB() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      email       TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      created_at  TEXT DEFAULT (datetime('now')),
      last_login  TEXT
    );

    CREATE TABLE IF NOT EXISTS parts (
      id                TEXT PRIMARY KEY,
      user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      original_filename TEXT NOT NULL,
      display_name      TEXT NOT NULL,
      file_size         INTEGER DEFAULT 0,
      dimensions        TEXT DEFAULT '{}',
      feature_count     TEXT DEFAULT '{}',
      tags              TEXT DEFAULT '[]',
      notes             TEXT DEFAULT '',
      stp_sha256        TEXT,
      cam_sha256        TEXT,
      signature         TEXT,
      has_thumbnail     INTEGER DEFAULT 0,
      uploaded_at       TEXT DEFAULT (datetime('now')),
      updated_at        TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS folders (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      parent_id  TEXT REFERENCES folders(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS part_folders (
      part_id   TEXT NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
      folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
      PRIMARY KEY (part_id, folder_id)
    );
  `);

  console.log('  ✅ Database initialized:', DB_PATH);
  return db;
}

function getDB() {
  if (!db) throw new Error('Database not initialized. Call initDB() first.');
  return db;
}

module.exports = { initDB, getDB };
