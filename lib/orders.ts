import crypto from "crypto";
import { InputError } from "./errors";
import { formatCents, splitAmount } from "./money";
import { normalizeParams, signedQuery, verifyParams } from "./sign";
import { many, one, run, withTransaction, type DB } from "./db";
import type { OrderStatus, SettlementStatus, WorkType } from "./labels";

export type OrderRow = {
  id: number;
  order_no: string;
  buyer_id: number;
  author_id: number;
  work_id: number;
  amount_cents: number;
  status: OrderStatus;
  payment_trade_no: string | null;
  created_at: number;
  paid_at: number | null;
  refunded_at: number | null;
};

export type OrderView = OrderRow & {
  title: string;
  type: WorkType;
  buyer_name: string;
  author_name: string;
};

export type LedgerRow = {
  id: number;
  author_id: number;
  work_id: number;
  order_id: number;
  gross_cents: number;
  platform_fee_cents: number;
  author_cents: number;
  settlement_status: SettlementStatus;
  created_at: number;
  settled_at: number | null;
  title?: string;
  order_no?: string;
  order_status?: OrderStatus;
};

const NOTIFY_WINDOW = 7 * 24 * 60 * 60 * 1000;

export function hasPaidAccess(db: DB, userId: number | null, workId: number): boolean {
  if (!userId) return false;
  return Boolean(
    one(db, `SELECT 1 AS ok FROM orders WHERE buyer_id = ? AND work_id = ? AND status = 'paid' LIMIT 1`, userId, workId),
  );
}

export function pendingOrder(db: DB, buyerId: number, workId: number): OrderRow | null {
  return one<OrderRow>(
    db,
    `SELECT * FROM orders WHERE buyer_id = ? AND work_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`,
    buyerId,
    workId,
  ) ?? null;
}

function makeOrderNo(now: number): string {
  const date = new Date(now);
  const p = (value: number) => String(value).padStart(2, "0");
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `NC${stamp}${crypto.randomInt(0, 1_000_000).toString().padStart(6, "0")}`;
}

export function checkoutUrl(options: {
  paymentBaseUrl: string;
  appBaseUrl: string;
  secret: string;
  orderNo: string;
  amountCents: number;
  subject: string;
  buyerName: string;
  authorCustomerNo: string;
  now?: number;
}): string {
  const now = options.now ?? Date.now();
  const params = {
    merchant: "ncstar",
    order_no: options.orderNo,
    amount_cents: String(options.amountCents),
    subject: options.subject.slice(0, 40),
    buyer_name: options.buyerName,
    author_customer_no: options.authorCustomerNo,
    notify_url: `${options.appBaseUrl}/api/payments/notify`,
    return_url: `${options.appBaseUrl}/pay/return?order_no=${encodeURIComponent(options.orderNo)}`,
    timestamp: String(now),
  };
  return `${options.paymentBaseUrl}/checkout?${signedQuery(params, options.secret)}`;
}

export function createOrder(
  db: DB,
  buyerId: number,
  workId: number,
  urls: { paymentBaseUrl: string; appBaseUrl: string; secret: string },
  now = Date.now(),
): { order: OrderRow; payUrl: string } {
  const buyer = one<{ id: number; display_name: string }>(db, `SELECT id, display_name FROM users WHERE id = ?`, buyerId);
  const work = one<{
    id: number;
    author_id: number;
    title: string;
    price_cents: number;
    status: string;
    customer_no: string | null;
    author_name: string;
  }>(
    db,
    `SELECT w.id, w.author_id, w.title, w.price_cents, w.status, u.customer_no, u.display_name AS author_name
     FROM works w JOIN users u ON u.id = w.author_id WHERE w.id = ?`,
    workId,
  );
  if (!buyer || !work || work.status !== "published") throw new InputError("作品不存在或尚未发布", 404);
  if (work.author_id === buyerId) throw new InputError("不能购买自己的作品");
  if (!Number.isInteger(work.price_cents) || work.price_cents <= 0) throw new InputError("这部作品是免费的");
  if (!work.customer_no) throw new InputError("作者还没有绑定支付站客户编号，暂时不能购买");
  if (hasPaidAccess(db, buyerId, workId)) throw new InputError("你已经购买过这部作品");

  let order = pendingOrder(db, buyerId, workId);
  if (order && order.amount_cents !== work.price_cents) {
    run(db, `UPDATE orders SET amount_cents = ? WHERE id = ? AND status = 'pending'`, work.price_cents, order.id);
    order = one<OrderRow>(db, `SELECT * FROM orders WHERE id = ?`, order.id) ?? order;
  }
  if (!order) {
    const orderNo = makeOrderNo(now);
    try {
      run(
        db,
        `INSERT INTO orders (
          order_no, buyer_id, author_id, work_id, amount_cents, status, payment_trade_no, created_at, paid_at, refunded_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, NULL, NULL)`,
        orderNo,
        buyerId,
        work.author_id,
        work.id,
        work.price_cents,
        now,
      );
    } catch (error) {
      order = pendingOrder(db, buyerId, workId);
      if (!order) throw error;
    }
    order = (order ?? one<OrderRow>(db, `SELECT * FROM orders WHERE order_no = ?`, orderNo)) || null;
  }
  if (!order) throw new Error("订单创建失败");
  if (order.status !== "pending") throw new InputError("订单状态异常");
  const payUrl = checkoutUrl({
    ...urls,
    orderNo: order.order_no,
    amountCents: order.amount_cents,
    subject: work.title,
    buyerName: buyer.display_name,
    authorCustomerNo: work.customer_no,
    now,
  });
  return { order, payUrl };
}

export type NotifyResult =
  | { ok: true; duplicate?: boolean }
  | { ok: false; status: number; error: string };

export function handlePaymentNotify(db: DB, payload: Record<string, unknown>, secret: string, feeBps: number, now = Date.now()): NotifyResult {
  if (!verifyParams(payload, secret)) return { ok: false, status: 401, error: "签名无效" };
  const fields = normalizeParams(payload);
  const orderNo = fields.order_no;
  const status = fields.status;
  const amount = Number(fields.amount_cents);
  const timestamp = Number(fields.timestamp);
  if (!orderNo || (status !== "paid" && status !== "refunded") || !Number.isInteger(amount) || !Number.isInteger(timestamp)) {
    return { ok: false, status: 400, error: "通知字段无效" };
  }
  if (Math.abs(now - timestamp) > NOTIFY_WINDOW) return { ok: false, status: 401, error: "通知已过期" };

  const order = one<OrderRow>(db, `SELECT * FROM orders WHERE order_no = ?`, orderNo);
  if (!order) return { ok: false, status: 404, error: "订单不存在" };
  if (order.amount_cents !== amount) return { ok: false, status: 400, error: "金额不一致" };

  if (status === "paid") {
    if (order.status === "paid") return { ok: true, duplicate: true };
    if (order.status !== "pending") return { ok: false, status: 409, error: "订单状态不可支付" };
    const split = splitAmount(order.amount_cents, feeBps);
    try {
      withTransaction(db, () => {
        const changed = run(
          db,
          `UPDATE orders SET status = 'paid', paid_at = ?, payment_trade_no = ? WHERE id = ? AND status = 'pending'`,
          now,
          fields.trade_no || null,
          order.id,
        );
        if (changed !== 1) throw new Error("CONFLICT");
        run(
          db,
          `INSERT INTO ledger_entries (
            author_id, work_id, order_id, gross_cents, platform_fee_cents, author_cents, settlement_status, created_at, settled_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL)`,
          order.author_id,
          order.work_id,
          order.id,
          split.grossCents,
          split.platformFeeCents,
          split.authorCents,
          now,
        );
      });
    } catch (error) {
      const fresh = one<OrderRow>(db, `SELECT * FROM orders WHERE id = ?`, order.id);
      const ledger = one(db, `SELECT id FROM ledger_entries WHERE order_id = ?`, order.id);
      if (fresh?.status === "paid" && ledger) return { ok: true, duplicate: true };
      throw error;
    }
    return { ok: true };
  }

  if (order.status === "refunded") return { ok: true, duplicate: true };
  if (order.status !== "paid") return { ok: false, status: 409, error: "未支付的订单不能退款" };
  withTransaction(db, () => {
    const changed = run(
      db,
      `UPDATE orders SET status = 'refunded', refunded_at = ? WHERE id = ? AND status = 'paid'`,
      now,
      order.id,
    );
    if (changed !== 1) return;
    run(
      db,
      `UPDATE ledger_entries SET settlement_status = 'void', settled_at = NULL
       WHERE order_id = ? AND settlement_status = 'pending'`,
      order.id,
    );
  });
  return { ok: true };
}

export function handleSettlementNotify(db: DB, payload: Record<string, unknown>, secret: string, now = Date.now()): NotifyResult {
  if (!verifyParams(payload, secret)) return { ok: false, status: 401, error: "签名无效" };
  const fields = normalizeParams(payload);
  const orderNo = fields.order_no;
  const settlement = fields.settlement_status;
  const timestamp = Number(fields.timestamp);
  if (!orderNo || (settlement !== "pending" && settlement !== "settled") || !Number.isInteger(timestamp)) {
    return { ok: false, status: 400, error: "结算通知字段无效" };
  }
  if (Math.abs(now - timestamp) > NOTIFY_WINDOW) return { ok: false, status: 401, error: "通知已过期" };
  return applySettlement(db, orderNo, settlement, now);
}

export function applySettlement(db: DB, orderNo: string, settlement: "pending" | "settled", now = Date.now()): NotifyResult {
  const order = one<OrderRow>(db, `SELECT * FROM orders WHERE order_no = ?`, orderNo);
  if (!order) return { ok: false, status: 404, error: "订单不存在" };
  const ledger = one<LedgerRow>(db, `SELECT * FROM ledger_entries WHERE order_id = ?`, order.id);
  if (!ledger || ledger.settlement_status === "void") {
    return { ok: false, status: 409, error: "没有可结算的收入" };
  }
  if (order.status !== "paid" && !(order.status === "refunded" && ledger.settlement_status === "settled")) {
    return { ok: false, status: 409, error: "未支付的订单不能结算" };
  }
  if (ledger.settlement_status === settlement) return { ok: true, duplicate: true };
  run(
    db,
    `UPDATE ledger_entries SET settlement_status = ?, settled_at = ? WHERE id = ? AND settlement_status != 'void'`,
    settlement,
    settlement === "settled" ? now : null,
    ledger.id,
  );
  return { ok: true };
}

/** 从支付站跳回时只读订单。查询参数里的成功标记不改变任何状态。 */
export function readReturnState(db: DB, orderNo: string, query: Record<string, string>): {
  order: OrderView | null;
  forged: boolean;
} {
  const forged = ["status", "success", "paid", "result"].some((key) => query[key]);
  const order = one<OrderView>(
    db,
    `SELECT o.*, w.title, w.type, buyer.display_name AS buyer_name, author.display_name AS author_name
     FROM orders o
     JOIN works w ON w.id = o.work_id
     JOIN users buyer ON buyer.id = o.buyer_id
     JOIN users author ON author.id = o.author_id
     WHERE o.order_no = ?`,
    orderNo,
  );
  return { order: order ?? null, forged };
}

export function listBuyerOrders(db: DB, userId: number): OrderView[] {
  return many<OrderView>(
    db,
    `SELECT o.*, w.title, w.type, buyer.display_name AS buyer_name, author.display_name AS author_name
     FROM orders o
     JOIN works w ON w.id = o.work_id
     JOIN users buyer ON buyer.id = o.buyer_id
     JOIN users author ON author.id = o.author_id
     WHERE o.buyer_id = ?
     ORDER BY o.created_at DESC`,
    userId,
  );
}

export function listAuthorOrders(db: DB, userId: number): OrderView[] {
  return many<OrderView>(
    db,
    `SELECT o.*, w.title, w.type, buyer.display_name AS buyer_name, author.display_name AS author_name
     FROM orders o
     JOIN works w ON w.id = o.work_id
     JOIN users buyer ON buyer.id = o.buyer_id
     JOIN users author ON author.id = o.author_id
     WHERE o.author_id = ?
     ORDER BY o.created_at DESC`,
    userId,
  );
}

export type IncomeSummary = {
  id: number;
  title: string;
  type: WorkType;
  paid_cents: number;
  pending_cents: number;
  settled_cents: number;
};

export function incomeByWork(db: DB, authorId: number): IncomeSummary[] {
  return many<IncomeSummary>(
    db,
    `SELECT w.id, w.title, w.type,
       COALESCE((SELECT SUM(o.amount_cents) FROM orders o WHERE o.work_id = w.id AND o.author_id = ? AND o.status = 'paid'), 0) AS paid_cents,
       COALESCE((SELECT SUM(l.author_cents) FROM ledger_entries l WHERE l.work_id = w.id AND l.author_id = ? AND l.settlement_status = 'pending'), 0) AS pending_cents,
       COALESCE((SELECT SUM(l.author_cents) FROM ledger_entries l WHERE l.work_id = w.id AND l.author_id = ? AND l.settlement_status = 'settled'), 0) AS settled_cents
     FROM works w
     WHERE w.author_id = ?
     ORDER BY w.created_at DESC`,
    authorId,
    authorId,
    authorId,
    authorId,
  );
}

export function listLedger(db: DB, authorId: number): LedgerRow[] {
  return many<LedgerRow>(
    db,
    `SELECT l.*, w.title, o.order_no, o.status AS order_status
     FROM ledger_entries l
     JOIN works w ON w.id = l.work_id
     JOIN orders o ON o.id = l.order_id
     WHERE l.author_id = ?
     ORDER BY l.created_at DESC, l.id DESC`,
    authorId,
  );
}

export async function syncAuthorSettlements(
  db: DB,
  authorId: number,
  options: { paymentBaseUrl: string; secret: string; fetcher?: typeof fetch; now?: number },
): Promise<{ checked: number; updated: number; errors: number }> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now();
  const rows = many<{
    id: number;
    settlement_status: SettlementStatus;
    order_no: string;
    amount_cents: number;
    order_status: OrderStatus;
  }>(
    db,
    `SELECT l.id, l.settlement_status, o.order_no, o.amount_cents, o.status AS order_status
     FROM ledger_entries l JOIN orders o ON o.id = l.order_id
     WHERE l.author_id = ? AND l.settlement_status != 'void'`,
    authorId,
  );
  let updated = 0;
  let errors = 0;
  for (const row of rows) {
    const params = { order_no: row.order_no, timestamp: String(now) };
    const url = `${options.paymentBaseUrl}/api/query?${signedQuery(params, options.secret)}`;
    try {
      const response = await fetcher(url, { method: "GET" });
      if (!response.ok) {
        errors += 1;
        continue;
      }
      const body = (await response.json()) as Record<string, unknown>;
      if (!verifyParams(body, options.secret)) {
        errors += 1;
        continue;
      }
      const fields = normalizeParams(body);
      if (fields.order_no !== row.order_no || Number(fields.amount_cents) !== row.amount_cents) {
        errors += 1;
        continue;
      }
      const settlement = fields.settlement_status;
      if (settlement !== "pending" && settlement !== "settled") {
        errors += 1;
        continue;
      }
      const before = one<OrderRow>(db, `SELECT * FROM orders WHERE order_no = ?`, row.order_no);
      const result = applySettlement(db, row.order_no, settlement, now);
      const after = one<OrderRow>(db, `SELECT * FROM orders WHERE order_no = ?`, row.order_no);
      if (before && after && before.status !== after.status) {
        throw new Error("查询结算时不应改变支付状态");
      }
      if (result.ok && !result.duplicate) updated += 1;
      if (!result.ok) errors += 1;
    } catch {
      errors += 1;
    }
  }
  return { checked: rows.length, updated, errors };
}

export function describeCents(cents: number): string {
  return `${formatCents(cents)} 元（${cents} 分）`;
}
