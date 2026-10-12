const DEV_PAYMENT_SECRET = "ncstar-dev-payment-secret";
const DEV_SESSION_SECRET = "ncstar-dev-session-secret";

export type AppConfig = {
  appBaseUrl: string;
  paymentBaseUrl: string;
  paymentSecret: string;
  sessionSecret: string;
  feeBps: number;
  bcryptRounds: number;
};

export function getConfig(): AppConfig {
  const feeBps = Number(process.env.PLATFORM_FEE_BPS ?? "1000");
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10000) {
    throw new Error("PLATFORM_FEE_BPS 必须是 0 到 10000 的整数");
  }
  const rounds = Number(process.env.BCRYPT_ROUNDS ?? "10");
  if (!Number.isInteger(rounds) || rounds < 4 || rounds > 14) {
    throw new Error("BCRYPT_ROUNDS 无效");
  }
  const paymentSecret = process.env.PAYMENT_SHARED_SECRET || DEV_PAYMENT_SECRET;
  const sessionSecret = process.env.SESSION_SECRET || DEV_SESSION_SECRET;
  if (process.env.NODE_ENV === "production") {
    if (paymentSecret === DEV_PAYMENT_SECRET) {
      throw new Error("生产环境必须设置 PAYMENT_SHARED_SECRET");
    }
    if (sessionSecret === DEV_SESSION_SECRET) {
      throw new Error("生产环境必须设置 SESSION_SECRET");
    }
  }
  return {
    appBaseUrl: (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, ""),
    paymentBaseUrl: (process.env.PAYMENT_BASE_URL || "http://localhost:3000/station").replace(/\/$/, ""),
    paymentSecret,
    sessionSecret,
    feeBps,
    bcryptRounds: rounds,
  };
}
