import { createHmac, timingSafeEqual } from 'node:crypto';

export function canonicalString(params) {
  return Object.entries(params)
    .filter(([key, value]) => key !== 'sign' && value !== undefined && value !== null && String(value) !== '')
    .map(([key, value]) => [String(key), String(value)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

export function signParams(secret, params) {
  return createHmac('sha256', secret).update(canonicalString(params)).digest('hex');
}

export function verifyParams(secret, params) {
  if (!params || typeof params !== 'object') return false;
  const given = String(params.sign ?? '');
  const expected = signParams(secret, params);
  const left = Buffer.from(given);
  const right = Buffer.from(expected);
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export function freshTimestamp(value, windowMs) {
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  return Math.abs(Date.now() - n) <= windowMs;
}
