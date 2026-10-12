import crypto from "crypto";
import { one, run, type DB } from "./db";

export const SESSION_COOKIE = "ncstar_session";
const SESSION_MS = 14 * 24 * 60 * 60 * 1000;

export type User = {
  id: number;
  email: string;
  password_hash: string;
  display_name: string;
  customer_no: string | null;
  created_at: number;
};

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createSession(db: DB, userId: number, now = Date.now()): string {
  const token = crypto.randomBytes(32).toString("hex");
  run(
    db,
    `INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
    hashToken(token),
    userId,
    now + SESSION_MS,
    now,
  );
  return token;
}

export function userFromToken(db: DB, token: string | undefined | null, now = Date.now()): User | null {
  if (!token) return null;
  const user = one<User>(
    db,
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    hashToken(token),
    now,
  );
  return user ?? null;
}

export function deleteSession(db: DB, token: string | undefined | null): void {
  if (!token) return;
  run(db, `DELETE FROM sessions WHERE token_hash = ?`, hashToken(token));
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MS / 1000,
    secure: process.env.NODE_ENV === "production",
  };
}
