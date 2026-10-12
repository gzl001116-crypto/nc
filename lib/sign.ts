import crypto from "crypto";

export type ParamMap = Record<string, string>;

export function normalizeParams(input: Record<string, unknown>): ParamMap {
  const params: ParamMap = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "sign" || value === undefined || value === null || value === "") continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) continue;
      params[key] = Number.isInteger(value) ? String(value) : String(value);
      continue;
    }
    if (typeof value === "boolean") {
      params[key] = value ? "true" : "false";
      continue;
    }
    params[key] = String(value);
  }
  return params;
}

export function canonical(params: ParamMap): string {
  return Object.keys(params)
    .filter((key) => key !== "sign" && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
}

export function signParams(params: ParamMap, secret: string): string {
  return crypto.createHmac("sha256", secret).update(canonical(params)).digest("hex");
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function verifyParams(input: Record<string, unknown>, secret: string): boolean {
  const provided = typeof input.sign === "string" ? input.sign : "";
  if (!/^[a-f0-9]{64}$/.test(provided)) return false;
  const expected = signParams(normalizeParams(input), secret);
  return safeEqual(provided, expected);
}

export function signedQuery(params: ParamMap, secret: string): string {
  const sign = signParams(params, secret);
  return new URLSearchParams({ ...params, sign }).toString();
}
