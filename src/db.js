import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  qinglan_customer_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS email_codes (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mailbox (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('novel', 'comic', 'video')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  cover_path TEXT,
  body TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  preview_mode TEXT NOT NULL CHECK (preview_mode IN ('progress', 'content')),
  preview_percent INTEGER,
  preview_text TEXT NOT NULL DEFAULT '',
  publish_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'published')),
  published_at INTEGER,
  view_count INTEGER NOT NULL DEFAULT 0,
  like_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS work_assets (
  id INTEGER PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('page', 'video')),
  path TEXT NOT NULL,
  mime TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS work_views (
  user_id INTEGER NOT NULL REFERENCES users(id),
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, work_id)
);

CREATE TABLE IF NOT EXISTS work_likes (
  user_id INTEGER NOT NULL REFERENCES users(id),
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
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
  qinglan_trade_no TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  refunded_at INTEGER
);

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES users(id),
  work_id INTEGER NOT NULL REFERENCES works(id),
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  gross_cents INTEGER NOT NULL,
  platform_fee_cents INTEGER NOT NULL,
  author_cents INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_settlement', 'settled', 'reversed')),
  created_at INTEGER NOT NULL,
  settled_at INTEGER
);

CREATE TABLE IF NOT EXISTS qinglan_trades (
  trade_no TEXT PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL,
  payout_cents INTEGER NOT NULL,
  platform_fee_cents INTEGER NOT NULL,
  buyer_customer_id TEXT NOT NULL,
  payee_customer_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  notify_url TEXT NOT NULL,
  settle_url TEXT NOT NULL,
  return_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('created', 'paid', 'refunded')),
  settle_status TEXT NOT NULL CHECK (settle_status IN ('unpaid', 'pending_settlement', 'settled')),
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  settled_at INTEGER
);

CREATE TABLE IF NOT EXISTS qinglan_accounts (
  customer_id TEXT PRIMARY KEY,
  account_name TEXT NOT NULL DEFAULT '',
  account_mask TEXT NOT NULL DEFAULT '',
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS qinglan_payouts (
  id INTEGER PRIMARY KEY,
  customer_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_works_pub ON works(status, published_at);
CREATE INDEX IF NOT EXISTS idx_codes_email ON email_codes(email, purpose, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_author ON orders(author_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_author ON ledger(author_id, work_id);
`;

export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export function immediate(db, fn) {
  return db.transaction(fn).immediate();
}
