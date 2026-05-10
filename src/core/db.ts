import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(__dirname, '../../data/database.sqlite');

// Ensure data directory exists
if (!fs.existsSync(path.dirname(DB_PATH))) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const db = new Database(DB_PATH);

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL, -- 'keyword', 'channel', 'user'
    value TEXT NOT NULL,
    status TEXT DEFAULT 'candidate', -- 'candidate', 'active', 'low-priority', 'stopped'
    score REAL DEFAULT 0,
    last_hit_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(type, value)
  );

  CREATE TABLE IF NOT EXISTS collected_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER,
    title TEXT,
    url TEXT UNIQUE,
    summary TEXT,
    raw_content TEXT,
    published_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(source_id) REFERENCES sources(id)
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL, -- 'daily', 'weekly', 'monthly'
    content TEXT,
    report_date TEXT NOT NULL, -- 'YYYY-MM-DD'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS adoption_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER,
    source_id INTEGER,
    is_adopted INTEGER, -- 1 or 0
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(report_id) REFERENCES reports(id),
    FOREIGN KEY(source_id) REFERENCES sources(id)
  );
`);

export default db;
