import crypto from "crypto";
import { sameOriginUrl } from "./format";
import { signParams, verifyParams } from "./sign";
import { one, run, type DB } from "./db";

export type GatewayRow = {
  order_no: string;
  amount_cents: number;
  status: "unpaid" | "paid" | "refunded";
  settlement_status: "pending" | "settled";
  notify_url: string;
  return_url: string;
  author_customer_no: string | null;
  buyer_name: string | null;
  subject: string;
  trade_no: string | null;
  created_at: number;
  updated_at: number;
};

const CHECKOUT_WINDOW = 30 * 60 * 1000;
const QUERY_WINDOW = 5 * 60 * 1000;

export function openCheckout(
  db: DB,
  params: Record<string, string>,
  secret: string,
  appBaseUrl: string,
  now = Date.now(),
): { ok: true; row: GatewayRow } | { ok: false; error: string } {
  if (!verifyParams(params, secret)) return { ok: false, error: "签名无效，支付站拒绝打开收银台" };
  const timestamp = Number(params.timestamp);
  const amount = Number(params.amount_cents);
  if (!params.order_no || !Number.isInteger(amount) || amount <= 0 || !Number.isInteger(timestamp)) {
    return { ok: false, error: "收银台参数无效" };
  }
  if (Math.abs(now - timestamp) > CHECKOUT_WINDOW) return { ok: false, error: "支付链接已过期，请回 NCstar 重新下单" };
  if (!sameOriginUrl(params.notify_url || "", appBaseUrl) || !sameOriginUrl(params.return_url || "", appBaseUrl)) {
    return { ok: false, error: "通知地址或返回地址不在 NCstar" };
  }
  const existing = getGateway(db, params.order_no);
  if (!existing) {
    run(
      db,
      `INSERT INTO gateway_payments (
        order_no, amount_cents, status, settlement_status, notify_url, return_url,
        author_customer_no, buyer_name, subject, trade_no, created_at, updated_at
      ) VALUES (?, ?, 'unpaid', 'pending', ?, ?, ?, ?, ?, NULL, ?, ?)`,
      params.order_no,
      amount,
      params.notify_url,
      params.return_url,
      params.author_customer_no || null,
      params.buyer_name || null,
      params.subject || "NCstar 作品",
      now,
      now,
    );
  } else if (existing.status === "unpaid") {
    run(
      db,
      `UPDATE gateway_payments
       SET amount_cents = ?, notify_url = ?, return_url = ?, author_customer_no = ?, buyer_name = ?, subject = ?, updated_at = ?
       WHERE order_no = ? AND status = 'unpaid'`,
      amount,
      params.notify_url,
      params.return_url,
      params.author_customer_no || null,
      params.buyer_name || null,
      params.subject || existing.subject,
      now,
      params.order_no,
    );
  }
  const row = getGateway(db, params.order_no);
  if (!row) return { ok: false, error: "支付单创建失败" };
  return { ok: true, row };
}

export function getGateway(db: DB, orderNo: string): GatewayRow | null {
  return one<GatewayRow>(db, `SELECT * FROM gateway_payments WHERE order_no = ?`, orderNo) ?? null;
}

function forgedReturn(returnUrl: string): string {
  const url = new URL(returnUrl);
  url.searchParams.set("status", "paid");
  url.searchParams.set("success", "1");
  return url.toString();
}

async function postNotify(
  url: string,
  payload: Record<string, string>,
  secret: string,
  fetcher: typeof fetch,
): Promise<{ status: number; body: string }> {
  const body = {
    ...payload,
    amount_cents: payload.amount_cents ? Number(payload.amount_cents) : undefined,
    timestamp: Number(payload.timestamp),
    sign: signParams(payload, secret),
  };
  if (!payload.amount_cents) delete body.amount_cents;
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.text() };
}

export async function gatewayPay(
  db: DB,
  orderNo: string,
  secret: string,
  appBaseUrl: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<{ redirect: string; notifyStatus: number; notifyBody: string }> {
  const row = requirePayable(db, orderNo, appBaseUrl);
  let tradeNo = row.trade_no;
  if (row.status === "unpaid") {
    tradeNo = `T${now}${crypto.randomInt(1000, 9999)}`;
    run(
      db,
      `UPDATE gateway_payments SET status = 'paid', trade_no = ?, updated_at = ? WHERE order_no = ? AND status = 'unpaid'`,
      tradeNo,
      now,
      orderNo,
    );
  }
  if (!tradeNo) throw new Error("缺少支付流水号");
  const notify = await postNotify(
    row.notify_url,
    {
      order_no: row.order_no,
      trade_no: tradeNo,
      amount_cents: String(row.amount_cents),
      status: "paid",
      timestamp: String(now),
    },
    secret,
    fetcher,
  );
  return { redirect: forgedReturn(row.return_url), notifyStatus: notify.status, notifyBody: notify.body };
}

export function gatewayReturnOnly(db: DB, orderNo: string, appBaseUrl: string): { redirect: string } {
  const row = getGateway(db, orderNo);
  if (!row || !sameOriginUrl(row.return_url, appBaseUrl)) throw new Error("支付单不存在");
  return { redirect: forgedReturn(row.return_url) };
}

export async function gatewayRefund(
  db: DB,
  orderNo: string,
  secret: string,
  appBaseUrl: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<{ notifyStatus: number; notifyBody: string }> {
  const row = getGateway(db, orderNo);
  if (!row || !sameOriginUrl(row.notify_url, appBaseUrl)) throw new Error("支付单不存在");
  if (row.status !== "paid" && row.status !== "refunded") throw new Error("还没有支付，不能退款");
  if (row.status === "paid") {
    run(db, `UPDATE gateway_payments SET status = 'refunded', updated_at = ? WHERE order_no = ?`, now, orderNo);
  }
  const notify = await postNotify(
    row.notify_url,
    {
      order_no: row.order_no,
      trade_no: row.trade_no || "",
      amount_cents: String(row.amount_cents),
      status: "refunded",
      timestamp: String(now),
    },
    secret,
    fetcher,
  );
  return { notifyStatus: notify.status, notifyBody: notify.body };
}

export async function gatewaySettle(
  db: DB,
  orderNo: string,
  secret: string,
  appBaseUrl: string,
  notify: boolean,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<{ notifyStatus: number | null; notifyBody: string }> {
  const row = getGateway(db, orderNo);
  if (!row || !sameOriginUrl(row.notify_url, appBaseUrl)) throw new Error("支付单不存在");
  if (row.status !== "paid") throw new Error("只有已支付的单可以结算");
  run(
    db,
    `UPDATE gateway_payments SET settlement_status = 'settled', updated_at = ? WHERE order_no = ?`,
    now,
    orderNo,
  );
  if (!notify) return { notifyStatus: null, notifyBody: "" };
  const settlementUrl = new URL(row.notify_url);
  settlementUrl.pathname = "/api/payments/settlement";
  const result = await postNotify(
    settlementUrl.toString(),
    {
      order_no: row.order_no,
      settlement_status: "settled",
      timestamp: String(now),
    },
    secret,
    fetcher,
  );
  return { notifyStatus: result.status, notifyBody: result.body };
}

export function gatewayQuery(
  db: DB,
  params: Record<string, string>,
  secret: string,
  now = Date.now(),
): { status: number; body: Record<string, unknown> } {
  if (!verifyParams(params, secret)) return { status: 401, body: { error: "签名无效" } };
  const timestamp = Number(params.timestamp);
  if (!Number.isInteger(timestamp) || Math.abs(now - timestamp) > QUERY_WINDOW) {
    return { status: 401, body: { error: "查询已过期" } };
  }
  const row = params.order_no ? getGateway(db, params.order_no) : null;
  if (!row) return { status: 404, body: { error: "支付单不存在" } };
  const payload = {
    order_no: row.order_no,
    status: row.status,
    settlement_status: row.settlement_status,
    amount_cents: String(row.amount_cents),
    timestamp: String(now),
  };
  return {
    status: 200,
    body: {
      ...payload,
      amount_cents: row.amount_cents,
      timestamp: now,
      sign: signParams(payload, secret),
    },
  };
}

function requirePayable(db: DB, orderNo: string, appBaseUrl: string): GatewayRow {
  const row = getGateway(db, orderNo);
  if (!row || !sameOriginUrl(row.notify_url, appBaseUrl)) throw new Error("支付单不存在");
  if (row.status === "refunded") throw new Error("这笔支付已退款");
  return row;
}

export function queryToParams(searchParams: Record<string, string | string[] | undefined>): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    const text = Array.isArray(value) ? value[0] : value;
    if (text) params[key] = text;
  }
  return params;
}
