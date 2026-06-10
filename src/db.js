const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

//resolve db path relative to the project root
const dbPath = path.resolve(__dirname, '..', process.env.DATABASE_URL || 'chronotask.db');
const db = new Database(dbPath);

db.pragma('foreign_keys=on;');

//initialize
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP

    );

    CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        method TEXT NOT NULL DEFAULT 'GET',
        headers TEXT,                  -- JSON stringified headers
        payload TEXT,                  -- JSON stringified body
        schedule_type  TEXT NOT NULL,  -- 'once' or 'interval'
        schedule_value INTEGER NOT NULL, -- Delay or interval in seconds
        next_run_at INTEGER NOT NULL, -- Epoch timestamp (ms) of next execution
        status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed', 'paused'
        failure_count INTEGER DEFAULT 0,
        last_error TEXT,              -- Cache for the latest execution error
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        
    );

    CREATE TABLE IF NOT EXISTS job_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL,
        attempt_number INTEGER NOT NULL,  -- Traces retries (1, 2, 3...)
        executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        status_code INTEGER,
        response_time_ms INTEGER,
        response_body TEXT,
        error_message TEXT,
        FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );
`);

console.log('Database initialized Successfully with updated schema');

module.exports = db;