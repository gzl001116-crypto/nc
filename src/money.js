export function yuanTextToCents(text) {
  const s = String(text ?? '').trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) {
    throw new Error('价格须为非负数字，最多两位小数');
  }
  const [yuan, frac = ''] = s.split('.');
  const cents = Number(yuan) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents)) throw new Error('价格超出范围');
  return cents;
}

export function parseCents(value) {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || !Number.isSafeInteger(value)) return null;
    return value;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

export function formatCents(cents) {
  const n = Number(cents);
  if (!Number.isSafeInteger(n)) return '¥0.00';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const yuan = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}¥${yuan}.${frac}`;
}

export function splitFee(amountCents, feeBps) {
  if (!Number.isInteger(amountCents) || amountCents < 0 || !Number.isSafeInteger(amountCents)) {
    throw new Error('金额必须是非负整数分');
  }
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10000) {
    throw new Error('分成比例无效');
  }
  const platformFeeCents = Math.floor((amountCents * feeBps) / 10000);
  const authorCents = amountCents - platformFeeCents;
  return { platformFeeCents, authorCents };
}

export function formatBps(bps) {
  const pct = bps / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2)}%`;
}
