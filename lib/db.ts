import fs from "fs";
import path from "path";
import { DatabaseSync, type SqlValue } from "node:sqlite";

export type DB = DatabaseSync;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 3000;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  customer_no TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS email_codes (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mailbox (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('novel', 'comic', 'video')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  cover_path TEXT,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  preview_mode TEXT NOT NULL CHECK (preview_mode IN ('progress', 'content')),
  preview_percent INTEGER NOT NULL DEFAULT 0 CHECK (preview_percent >= 0 AND preview_percent <= 100),
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'published')),
  publish_at INTEGER,
  published_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES works(id),
  title TEXT NOT NULL,
  body TEXT,
  media_path TEXT,
  sort_index INTEGER NOT NULL,
  is_preview INTEGER NOT NULL DEFAULT 0 CHECK (is_preview IN (0, 1))
);

CREATE TABLE IF NOT EXISTS work_views (
  user_id INTEGER NOT NULL REFERENCES users(id),
  work_id INTEGER NOT NULL REFERENCES works(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, work_id)
);

CREATE TABLE IF NOT EXISTS work_likes (
  user_id INTEGER NOT NULL REFERENCES users(id),
  work_id INTEGER NOT NULL REFERENCES works(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, work_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  author_id INTEGER NOT NULL REFERENCES users(id),
  work_id INTEGER NOT NULL REFERENCES works(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'refunded')),
  payment_trade_no TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  refunded_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_one_pending
  ON orders(buyer_id, work_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS ledger_entries (
  id INTEGER PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES users(id),
  work_id INTEGER NOT NULL REFERENCES works(id),
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  gross_cents INTEGER NOT NULL,
  platform_fee_cents INTEGER NOT NULL,
  author_cents INTEGER NOT NULL,
  settlement_status TEXT NOT NULL CHECK (settlement_status IN ('pending', 'settled', 'void')),
  created_at INTEGER NOT NULL,
  settled_at INTEGER
);

CREATE TABLE IF NOT EXISTS gateway_payments (
  order_no TEXT PRIMARY KEY,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('unpaid', 'paid', 'refunded')),
  settlement_status TEXT NOT NULL CHECK (settlement_status IN ('pending', 'settled')),
  notify_url TEXT NOT NULL,
  return_url TEXT NOT NULL,
  author_customer_no TEXT,
  buyer_name TEXT,
  subject TEXT NOT NULL,
  trade_no TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

let singleton: DB | null = null;

export function openDatabase(file: string): DB {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

export function getDb(): DB {
  if (!singleton) {
    const file = process.env.DB_PATH || path.join(process.cwd(), "data", "ncstar.sqlite");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    singleton = openDatabase(file);
  }
  return singleton;
}

export function one<T>(db: DB, sql: string, ...params: SqlValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function many<T>(db: DB, sql: string, ...params: SqlValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function run(db: DB, sql: string, ...params: SqlValue[]): number {
  return Number(db.prepare(sql).run(...params).changes);
}

export function withTransaction<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* already closed */
    }
    throw error;
  }
}
