/** 金额一律用分表示，运算只走整数。 */

export function yuanToCents(input: string): number | null {
  const text = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return cents;
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const value = Math.abs(cents);
  const yuan = Math.floor(value / 100);
  const frac = String(value % 100).padStart(2, "0");
  return `${sign}${yuan}.${frac}`;
}

export function splitAmount(grossCents: number, feeBps: number): {
  grossCents: number;
  platformFeeCents: number;
  authorCents: number;
} {
  if (!Number.isInteger(grossCents) || grossCents < 0) {
    throw new Error("金额必须是非负整数分");
  }
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10000) {
    throw new Error("分成比例无效");
  }
  const platformFeeCents = Math.floor((grossCents * feeBps) / 10000);
  return {
    grossCents,
    platformFeeCents,
    authorCents: grossCents - platformFeeCents,
  };
}

export function formatFee(feeBps: number): string {
  const whole = Math.floor(feeBps / 100);
  const frac = feeBps % 100;
  if (frac === 0) return `${whole}%`;
  const text = String(frac).padStart(2, "0").replace(/0$/, "");
  return `${whole}.${text}%`;
}

/** 热度展示为点赞人数 / 浏览人数的百分比，保留一位小数。 */
export function formatHeat(likes: number, views: number): string {
  if (views <= 0) return "—";
  const tenths = Math.round((likes * 1000) / views);
  const whole = Math.floor(tenths / 10);
  const frac = Math.abs(tenths % 10);
  return `${whole}.${frac}%`;
}
