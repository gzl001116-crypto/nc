import { randomBytes } from 'node:crypto';
import { HttpError } from './errors.js';
import { immediate } from './db.js';
import { parseCents, splitFee } from './money.js';
import { freshTimestamp, signParams, verifyParams } from './sign.js';
import { getWork } from './catalog.js';

const PAY_WINDOW_MS = 15 * 60 * 1000;

export function makeOrderNo(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `NC${stamp}${randomBytes(4).toString('hex').toUpperCase()}`;
}

export function buildPayUrl(config, { order, work, buyer, authorCustomerId }) {
  const fee = splitFee(order.amount_cents, config.platformFeeBps);
  const params = {
    merchantId: config.merchantId,
    orderNo: order.order_no,
    amountCents: order.amount_cents,
    payoutCents: fee.authorCents,
    platformFeeCents: fee.platformFeeCents,
    subject: Array.from(work.title).slice(0, 40).join(''),
    buyerCustomerId: buyer.qinglanCustomerId,
    payeeCustomerId: authorCustomerId,
    notifyUrl: `${config.publicBaseUrl}/api/payments/qinglan/notify`,
    settleUrl: `${config.publicBaseUrl}/api/payments/qinglan/settlement`,
    returnUrl: `${config.publicBaseUrl}/orders/${encodeURIComponent(order.order_no)}/result`,
    timestamp: Date.now(),
  };
  params.sign = signParams(config.sharedSecret, params);
  const url = new URL(`${config.qinglanBaseUrl}/checkout`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url.toString();
}

function orderView(row) {
  return {
    orderNo: row.order_no,
    buyerId: row.buyer_id,
    buyerNickname: row.buyer_nickname,
    authorId: row.author_id,
    authorNickname: row.author_nickname,
    workId: row.work_id,
    workTitle: row.title,
    workType: row.type,
    amountCents: row.amount_cents,
    status: row.status,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    refundedAt: row.refunded_at,
  };
}

const ORDER_SELECT = `
  SELECT orders.*, works.title, works.type,
         authors.nickname AS author_nickname,
         buyers.nickname AS buyer_nickname
  FROM orders
  JOIN works ON works.id = orders.work_id
  JOIN users authors ON authors.id = orders.author_id
  JOIN users buyers ON buyers.id = orders.buyer_id
`;

export function readOrder(db, orderNo) {
  return db.prepare(`${ORDER_SELECT} WHERE orders.order_no = ?`).get(orderNo);
}

export function createOrder(db, config, buyer, workId) {
  const id = Number(workId);
  if (!Number.isInteger(id)) throw new HttpError(400, '作品无效');
  const work = getWork(db, id);
  if (!work || work.status !== 'published') throw new HttpError(404, '作品不存在');
  if (work.author_id === buyer.id) throw new HttpError(400, '不能购买自己的作品');
  if (work.price_cents <= 0) throw new HttpError(400, '这部作品免费，无需下单');
  const paid = db.prepare(`
    SELECT order_no FROM orders WHERE buyer_id = ? AND work_id = ? AND status = 'paid' LIMIT 1
  `).get(buyer.id, work.id);
  if (paid) throw new HttpError(409, '你已经买过这部作品');
  let order = db.prepare(`
    SELECT * FROM orders
    WHERE buyer_id = ? AND work_id = ? AND status = 'pending'
    ORDER BY id DESC LIMIT 1
  `).get(buyer.id, work.id);
  if (!order) {
    const orderNo = makeOrderNo();
    const info = db.prepare(`
      INSERT INTO orders (order_no, buyer_id, author_id, work_id, amount_cents, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(orderNo, buyer.id, work.author_id, work.id, work.price_cents, Date.now());
    order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(info.lastInsertRowid));
  }
  const full = readOrder(db, order.order_no);
  const payUrl = buildPayUrl(config, {
    order,
    work,
    buyer,
    authorCustomerId: work.author_customer_id,
  });
  return { order: orderView(full), payUrl };
}

function loadNotifiedOrder(db, orderNo, amountCents) {
  const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo);
  if (!order) return { error: { status: 404, message: '订单不存在' } };
  if (order.amount_cents !== amountCents) return { error: { status: 400, message: '金额不一致' } };
  return { order };
}

export function applyGatewayNotify(db, config, payload) {
  if (!verifyParams(config.sharedSecret, payload)) {
    return { ok: false, status: 401, error: '签名无效' };
  }
  if (payload.merchantId !== config.merchantId) {
    return { ok: false, status: 401, error: '商户不匹配' };
  }
  const amountCents = parseCents(payload.amountCents);
  const tradeStatus = String(payload.tradeStatus || '');
  if (amountCents === null || !payload.orderNo || !payload.tradeNo) {
    return { ok: false, status: 400, error: '通知字段不完整' };
  }
  if (tradeStatus !== 'PAID' && tradeStatus !== 'REFUNDED') {
    return { ok: false, status: 400, error: '不支持的支付状态' };
  }
  return immediate(db, () => {
    const loaded = loadNotifiedOrder(db, String(payload.orderNo), amountCents);
    if (loaded.error) return { ok: false, status: loaded.error.status, error: loaded.error.message };
    const order = loaded.order;
    const fresh = freshTimestamp(payload.timestamp, PAY_WINDOW_MS);
    if (tradeStatus === 'PAID') {
      if (order.status === 'paid') return { ok: true, duplicate: true };
      if (!fresh) return { ok: false, status: 400, error: '通知已过期' };
      if (order.status !== 'pending') return { ok: false, status: 409, error: '订单状态不可支付' };
      const now = Date.now();
      const info = db.prepare(`
        UPDATE orders SET status = 'paid', paid_at = ?, qinglan_trade_no = ?
        WHERE id = ? AND status = 'pending'
      `).run(now, String(payload.tradeNo), order.id);
      if (info.changes !== 1) return { ok: true, duplicate: true };
      const fee = splitFee(order.amount_cents, config.platformFeeBps);
      db.prepare(`
        INSERT INTO ledger (
          author_id, work_id, order_id, gross_cents, platform_fee_cents, author_cents, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending_settlement', ?)
      `).run(order.author_id, order.work_id, order.id, order.amount_cents, fee.platformFeeCents, fee.authorCents, now);
      return { ok: true, duplicate: false };
    }
    if (order.status === 'refunded') return { ok: true, duplicate: true };
    if (!fresh) return { ok: false, status: 400, error: '通知已过期' };
    if (order.status !== 'paid' && order.status !== 'pending') {
      return { ok: false, status: 409, error: '订单状态不可退款' };
    }
    const now = Date.now();
    const info = db.prepare(`
      UPDATE orders SET status = 'refunded', refunded_at = ?, qinglan_trade_no = COALESCE(qinglan_trade_no, ?)
      WHERE id = ? AND status IN ('pending', 'paid')
    `).run(now, String(payload.tradeNo), order.id);
    if (info.changes !== 1) return { ok: true, duplicate: true };
    db.prepare(`
      UPDATE ledger SET status = 'reversed'
      WHERE order_id = ? AND status = 'pending_settlement'
    `).run(order.id);
    return { ok: true, duplicate: false };
  });
}

export function applySettlement(db, config, payload) {
  if (!verifyParams(config.sharedSecret, payload)) {
    return { ok: false, status: 401, error: '签名无效' };
  }
  if (payload.merchantId !== config.merchantId) return { ok: false, status: 401, error: '商户不匹配' };
  if (String(payload.settleStatus) !== 'SETTLED') return { ok: false, status: 400, error: '结算状态无效' };
  const amountCents = parseCents(payload.amountCents);
  if (amountCents === null || !payload.orderNo) return { ok: false, status: 400, error: '结算字段不完整' };
  const settledAt = Number(payload.settledAt || payload.timestamp);
  if (!Number.isFinite(settledAt)) return { ok: false, status: 400, error: '结算时间无效' };
  return immediate(db, () => {
    const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(String(payload.orderNo));
    if (!order) return { ok: false, status: 404, error: '订单不存在' };
    if (order.amount_cents !== amountCents) return { ok: false, status: 400, error: '金额不一致' };
    if (order.status !== 'paid') return { ok: false, status: 409, error: '只有已支付订单可以结算' };
    const ledger = db.prepare('SELECT * FROM ledger WHERE order_id = ?').get(order.id);
    if (!ledger) return { ok: false, status: 409, error: '还没有收入记录' };
    if (ledger.status === 'settled') return { ok: true, duplicate: true };
    if (ledger.status !== 'pending_settlement') return { ok: false, status: 409, error: '这笔收入不能结算' };
    const info = db.prepare(`
      UPDATE ledger SET status = 'settled', settled_at = ?
      WHERE id = ? AND status = 'pending_settlement'
    `).run(settledAt, ledger.id);
    if (info.changes !== 1) return { ok: true, duplicate: true };
    return { ok: true, duplicate: false };
  });
}

export async function fetchSettlement(config, orderNo) {
  const params = {
    merchantId: config.merchantId,
    orderNo,
    timestamp: Date.now(),
  };
  params.sign = signParams(config.sharedSecret, params);
  const res = await fetch(`${config.qinglanBaseUrl}/api/settlement/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(5000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new HttpError(502, '支付站没有返回结算结果');
  if (!verifyParams(config.sharedSecret, data)) throw new HttpError(502, '支付站返回的签名无效');
  if (!freshTimestamp(data.timestamp, 5 * 60 * 1000)) throw new HttpError(502, '支付站返回已过期');
  if (String(data.orderNo) !== String(orderNo)) throw new HttpError(502, '支付站返回的订单号不一致');
  return data;
}

export async function syncSettlement(db, config, authorId, orderNo) {
  const params = [authorId];
  let sql = `
    SELECT orders.order_no FROM ledger
    JOIN orders ON orders.id = ledger.order_id
    WHERE ledger.author_id = ? AND ledger.status = 'pending_settlement' AND orders.status = 'paid'
  `;
  if (orderNo) {
    sql += ' AND orders.order_no = ?';
    params.push(orderNo);
  }
  const rows = db.prepare(sql).all(...params);
  if (orderNo && rows.length === 0) {
    const owned = db.prepare(`
      SELECT ledger.status FROM ledger
      JOIN orders ON orders.id = ledger.order_id
      WHERE ledger.author_id = ? AND orders.order_no = ?
    `).get(authorId, orderNo);
    if (!owned) throw new HttpError(404, '没有这笔收入');
    return { checked: 0, settled: 0 };
  }
  let settled = 0;
  for (const row of rows) {
    const data = await fetchSettlement(config, row.order_no);
    if (String(data.settleStatus) !== 'SETTLED') continue;
    const result = applySettlement(db, config, data);
    if (!result.ok) throw new HttpError(result.status || 502, result.error || '结算状态无法入账');
    if (!result.duplicate) settled += 1;
  }
  return { checked: rows.length, settled };
}

export function walletUrl(config, customerId) {
  const params = {
    customerId,
    merchantId: config.merchantId,
    timestamp: Date.now(),
  };
  params.sign = signParams(config.sharedSecret, params);
  const url = new URL(`${config.qinglanBaseUrl}/wallet`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url.toString();
}

export function incomeSummary(db, authorId) {
  return db.prepare(`
    SELECT
      works.id AS work_id,
      works.title AS title,
      works.type AS type,
      COALESCE(SUM(CASE WHEN orders.status = 'paid' THEN ledger.gross_cents ELSE 0 END), 0) AS paid_cents,
      COALESCE(SUM(CASE WHEN ledger.status = 'pending_settlement' THEN ledger.author_cents ELSE 0 END), 0) AS pending_cents,
      COALESCE(SUM(CASE WHEN ledger.status = 'settled' AND orders.status = 'paid' THEN ledger.author_cents ELSE 0 END), 0) AS settled_cents
    FROM works
    LEFT JOIN ledger ON ledger.work_id = works.id AND ledger.author_id = works.author_id
    LEFT JOIN orders ON orders.id = ledger.order_id
    WHERE works.author_id = ?
    GROUP BY works.id
    ORDER BY works.created_at DESC, works.id DESC
  `).all(authorId);
}

export function incomeEntries(db, authorId) {
  return db.prepare(`
    SELECT ledger.*, orders.order_no, orders.status AS order_status, orders.amount_cents,
           buyers.nickname AS buyer_nickname, works.title
    FROM ledger
    JOIN orders ON orders.id = ledger.order_id
    JOIN users buyers ON buyers.id = orders.buyer_id
    JOIN works ON works.id = ledger.work_id
    WHERE ledger.author_id = ?
    ORDER BY ledger.created_at DESC, ledger.id DESC
  `).all(authorId);
}

export function listBuyerOrders(db, buyerId) {
  return db.prepare(`${ORDER_SELECT} WHERE orders.buyer_id = ? ORDER BY orders.created_at DESC, orders.id DESC`).all(buyerId).map(orderView);
}

export function canSeeOrder(order, user) {
  if (!order || !user) return false;
  return order.buyer_id === user.id || order.author_id === user.id;
}
