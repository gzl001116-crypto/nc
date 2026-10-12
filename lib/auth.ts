import crypto from "crypto";
import bcrypt from "bcryptjs";
import { InputError } from "./errors";
import { many, one, run, type DB } from "./db";
import { createSession, type User } from "./session";
import { safeEqual } from "./sign";

const CODE_TTL = 10 * 60 * 1000;
const CODE_INTERVAL = 60 * 1000;

export type CodePurpose = "register" | "login";

type CodeRow = {
  id: number;
  code_hash: string;
  attempts: number;
};

function hashCode(code: string, pepper: string): string {
  return crypto.createHash("sha256").update(`${pepper}:${code}`).digest("hex");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export async function deliverCode(db: DB, email: string, code: string, now = Date.now()): Promise<void> {
  const subject = "NCstar 验证码";
  const body = `你的 NCstar 验证码是 ${code}，10 分钟内有效。如果不是你本人操作，请忽略这封邮件。`;
  if (process.env.NODE_ENV !== "production") {
    run(db, `INSERT INTO mailbox (email, subject, body, created_at) VALUES (?, ?, ?, ?)`, email, subject, body, now);
  }
  if (!process.env.SMTP_HOST) {
    if (process.env.NODE_ENV === "production") {
      throw new InputError("邮件服务未配置", 500);
    }
    return;
  }
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "1",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" }
      : undefined,
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || "NCstar <noreply@ncstar.local>",
    to: email,
    subject,
    text: body,
  });
}

export async function issueEmailCode(
  db: DB,
  emailInput: string,
  purpose: CodePurpose,
  pepper: string,
  now = Date.now(),
): Promise<void> {
  const email = normalizeEmail(emailInput);
  if (!isEmail(email)) throw new InputError("请填写有效邮箱");
  const existing = one<User>(db, `SELECT * FROM users WHERE email = ?`, email);
  if (purpose === "register" && existing) throw new InputError("该邮箱已注册，请直接登录");
  if (purpose === "login" && !existing) return;

  const last = one<{ created_at: number }>(
    db,
    `SELECT created_at FROM email_codes WHERE email = ? AND purpose = ? ORDER BY id DESC LIMIT 1`,
    email,
    purpose,
  );
  if (last && now - last.created_at < CODE_INTERVAL) {
    throw new InputError("请稍后再获取验证码", 429);
  }

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  run(
    db,
    `UPDATE email_codes SET used_at = ? WHERE email = ? AND purpose = ? AND used_at IS NULL`,
    now,
    email,
    purpose,
  );
  run(
    db,
    `INSERT INTO email_codes (email, purpose, code_hash, attempts, expires_at, used_at, created_at)
     VALUES (?, ?, ?, 0, ?, NULL, ?)`,
    email,
    purpose,
    hashCode(code, pepper),
    now + CODE_TTL,
    now,
  );
  await deliverCode(db, email, code, now);
}

export function consumeEmailCode(
  db: DB,
  emailInput: string,
  purpose: CodePurpose,
  code: string,
  pepper: string,
  now = Date.now(),
): boolean {
  const email = normalizeEmail(emailInput);
  if (!/^\d{6}$/.test(code)) return false;
  const row = one<CodeRow>(
    db,
    `SELECT id, code_hash, attempts FROM email_codes
     WHERE email = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?
     ORDER BY id DESC LIMIT 1`,
    email,
    purpose,
    now,
  );
  if (!row) return false;
  if (row.attempts >= 5) {
    run(db, `UPDATE email_codes SET used_at = ? WHERE id = ?`, now, row.id);
    return false;
  }
  const ok = safeEqual(hashCode(code, pepper), row.code_hash);
  if (!ok) {
    const attempts = row.attempts + 1;
    run(db, `UPDATE email_codes SET attempts = ? WHERE id = ?`, attempts, row.id);
    if (attempts >= 5) run(db, `UPDATE email_codes SET used_at = ? WHERE id = ?`, now, row.id);
    return false;
  }
  const changed = run(db, `UPDATE email_codes SET used_at = ? WHERE id = ? AND used_at IS NULL`, now, row.id);
  return changed === 1;
}

export function registerUser(
  db: DB,
  input: { email: string; password: string; displayName: string; code: string },
  pepper: string,
  rounds: number,
  now = Date.now(),
): { user: User; token: string } {
  const email = normalizeEmail(input.email);
  const displayName = input.displayName.trim().replace(/\s+/g, " ");
  if (!isEmail(email)) throw new InputError("请填写有效邮箱");
  if (input.password.length < 8 || input.password.length > 72) throw new InputError("密码需要 8 到 72 位");
  if (displayName.length < 1 || displayName.length > 30) throw new InputError("名字需要 1 到 30 个字");
  if (one(db, `SELECT id FROM users WHERE email = ?`, email)) throw new InputError("该邮箱已注册，请直接登录");
  if (!consumeEmailCode(db, email, "register", input.code.trim(), pepper, now)) {
    throw new InputError("验证码不正确或已过期");
  }
  const passwordHash = bcrypt.hashSync(input.password, rounds);
  run(
    db,
    `INSERT INTO users (email, password_hash, display_name, customer_no, created_at) VALUES (?, ?, ?, NULL, ?)`,
    email,
    passwordHash,
    displayName,
    now,
  );
  const user = one<User>(db, `SELECT * FROM users WHERE email = ?`, email);
  if (!user) throw new Error("注册失败");
  return { user, token: createSession(db, user.id, now) };
}

export function loginUser(
  db: DB,
  input: { email: string; password: string; code: string },
  pepper: string,
  now = Date.now(),
): { user: User; token: string } {
  const email = normalizeEmail(input.email);
  const user = one<User>(db, `SELECT * FROM users WHERE email = ?`, email);
  const passwordOk = user ? bcrypt.compareSync(input.password, user.password_hash) : false;
  if (!user || !passwordOk) throw new InputError("邮箱或密码不正确", 401);
  if (!consumeEmailCode(db, email, "login", input.code.trim(), pepper, now)) {
    throw new InputError("验证码不正确或已过期");
  }
  return { user, token: createSession(db, user.id, now) };
}

export function bindCustomer(db: DB, userId: number, customerNo: string): void {
  const value = customerNo.trim();
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(value)) {
    throw new InputError("客户编号为 2 到 64 位字母、数字、下划线或连字符");
  }
  const taken = one<{ id: number }>(db, `SELECT id FROM users WHERE customer_no = ? AND id != ?`, value, userId);
  if (taken) throw new InputError("这个客户编号已绑定到其他账号");
  run(db, `UPDATE users SET customer_no = ? WHERE id = ?`, value, userId);
}

export type Mail = { id: number; email: string; subject: string; body: string; created_at: number };

export function listMailbox(db: DB): Mail[] {
  return many<Mail>(db, `SELECT * FROM mailbox ORDER BY id DESC LIMIT 50`);
}
