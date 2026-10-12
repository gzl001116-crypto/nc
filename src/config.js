import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function makeConfig(overrides = {}) {
  const port = Number(overrides.port ?? process.env.PORT ?? 3000);
  const publicBaseUrl = overrides.publicBaseUrl
    ?? process.env.PUBLIC_BASE_URL
    ?? `http://127.0.0.1:${port}`;
  const dataDir = path.resolve(rootDir, overrides.dataDir ?? process.env.DATA_DIR ?? 'data');
  const feeBps = Number(overrides.platformFeeBps ?? process.env.PLATFORM_FEE_BPS ?? 2000);
  const smtpHost = overrides.smtpHost ?? process.env.SMTP_HOST;
  return {
    port,
    host: overrides.host ?? '0.0.0.0',
    publicBaseUrl,
    qinglanBaseUrl: overrides.qinglanBaseUrl
      ?? process.env.QINGLAN_BASE_URL
      ?? `${publicBaseUrl}/qinglan`,
    sharedSecret: overrides.sharedSecret
      ?? process.env.QINGLAN_SHARED_SECRET
      ?? 'dev-qinglan-secret-change-me',
    merchantId: overrides.merchantId ?? 'ncstar',
    platformFeeBps: feeBps,
    dataDir,
    uploadDir: overrides.uploadDir ?? path.join(dataDir, 'uploads'),
    dbFile: overrides.dbFile ?? path.join(dataDir, 'ncstar.db'),
    sessionDays: overrides.sessionDays ?? 14,
    codeTtlMs: overrides.codeTtlMs ?? 10 * 60 * 1000,
    codeCooldownMs: overrides.codeCooldownMs ?? 60 * 1000,
    devMailbox: overrides.devMailbox ?? !smtpHost,
    scheduler: overrides.scheduler ?? true,
    seed: overrides.seed ?? true,
    smtp: smtpHost
      ? {
          host: smtpHost,
          port: Number(process.env.SMTP_PORT || 587),
          secure: process.env.SMTP_SECURE === 'true',
          user: process.env.SMTP_USER || '',
          pass: process.env.SMTP_PASS || '',
          from: process.env.SMTP_FROM || 'NCstar <noreply@localhost>',
        }
      : null,
    publicDir: path.join(rootDir, 'public'),
    rootDir,
  };
}
