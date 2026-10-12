import { randomBytes } from 'node:crypto';
import { HttpError, wantsJson } from './errors.js';
import { formatCents, parseCents, yuanTextToCents } from './money.js';
import { freshTimestamp, signParams, verifyParams } from './sign.js';
import { esc, formatTime, qinglanPage } from './ui.js';

const WINDOW_MS = 15 * 60 * 1000;

function httpUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function mustCents(value, label) {
  const cents = parseCents(value);
  if (cents === null) throw new HttpError(400, `${label}须为整数分`);
  return cents;
}

async function postNotify(url, payload) {
  let last = '通知没有送达';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return true;
      last = `商户返回 ${res.status}`;
    } catch (err) {
      last = err.name === 'TimeoutError' ? '商户没有及时响应' : '商户暂时不可达';
    }
  }
  console.error('青澜通知失败', url, last);
  return false;
}

function paidPayload(config, trade) {
  const payload = {
    merchantId: config.merchantId,
    orderNo: trade.order_no,
    tradeNo: trade.trade_no,
    amountCents: trade.amount_cents,
    tradeStatus: 'PAID',
    timestamp: Date.now(),
  };
  payload.sign = signParams(config.sharedSecret, payload);
  return payload;
}

function refundPayload(config, trade) {
  const payload = {
    merchantId: config.merchantId,
    orderNo: trade.order_no,
    tradeNo: trade.trade_no,
    amountCents: trade.amount_cents,
    tradeStatus: 'REFUNDED',
    timestamp: Date.now(),
  };
  payload.sign = signParams(config.sharedSecret, payload);
  return payload;
}

function settlePayload(config, trade) {
  const payload = {
    merchantId: config.merchantId,
    orderNo: trade.order_no,
    tradeNo: trade.trade_no,
    amountCents: trade.amount_cents,
    settleStatus: 'SETTLED',
    settledAt: trade.settled_at,
    timestamp: Date.now(),
  };
  payload.sign = signParams(config.sharedSecret, payload);
  return payload;
}

function assertWallet(config, source) {
  const token = {
    customerId: source.customerId,
    merchantId: source.merchantId,
    timestamp: source.timestamp,
    sign: source.sign,
  };
  if (!verifyParams(config.sharedSecret, token)) throw new HttpError(401, '钱包链接签名无效');
  if (token.merchantId !== config.merchantId) throw new HttpError(401, '商户不匹配');
  if (!freshTimestamp(token.timestamp, 10 * 60 * 1000)) throw new HttpError(401, '链接已过期，请从 NCstar 收入页重新进入');
  const customerId = String(token.customerId || '');
  if (!/^QLC[A-Z0-9]+$/.test(customerId)) throw new HttpError(400, '客户编号无效');
  return customerId;
}

function walletQuery(source) {
  return new URLSearchParams({
    customerId: String(source.customerId),
    merchantId: String(source.merchantId),
    timestamp: String(source.timestamp),
    sign: String(source.sign),
  }).toString();
}

function balanceOf(db, customerId) {
  const settled = db.prepare(`
    SELECT COALESCE(SUM(payout_cents), 0) AS total
    FROM qinglan_trades
    WHERE payee_customer_id = ? AND status = 'paid' AND settle_status = 'settled'
  `).get(customerId).total;
  const paidOut = db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) AS total FROM qinglan_payouts WHERE customer_id = ?
  `).get(customerId).total;
  return settled - paidOut;
}

function maskAccount(value) {
  const digits = String(value ?? '').replace(/\s+/g, '');
  if (!/^\d{8,30}$/.test(digits)) throw new HttpError(400, '银行账号应为 8 到 30 位数字');
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

export function mountQinglan(app, { db, config }) {
  app.get('/qinglan', (_req, res) => {
    res.type('html').send(qinglanPage({
      title: '青澜支付站',
      body: `
        <section class="pay-card">
          <p class="eyebrow">Qinglan</p>
          <h1>青澜支付站</h1>
          <p>这里处理收银台、结算账户、提现和打款。NCstar 只展示订单和收入，不会向银行卡打款。</p>
        </section>`,
    }));
  });

  app.get('/qinglan/checkout', (req, res, next) => {
    try {
      const q = req.query;
      if (!verifyParams(config.sharedSecret, q)) throw new HttpError(401, '收银台签名无效');
      if (!freshTimestamp(q.timestamp, WINDOW_MS)) throw new HttpError(401, '收银台链接已过期');
      if (q.merchantId !== config.merchantId) throw new HttpError(401, '商户不匹配');
      const amountCents = mustCents(q.amountCents, '金额');
      const payoutCents = mustCents(q.payoutCents, '作者所得');
      const platformFeeCents = mustCents(q.platformFeeCents, '平台分成');
      if (amountCents <= 0 || payoutCents < 0 || platformFeeCents < 0 || payoutCents + platformFeeCents !== amountCents) {
        throw new HttpError(400, '金额与分成不相等');
      }
      const notifyUrl = httpUrl(q.notifyUrl);
      const settleUrl = httpUrl(q.settleUrl);
      const returnUrl = httpUrl(q.returnUrl);
      if (!notifyUrl || !settleUrl || !returnUrl) throw new HttpError(400, '回调地址无效');
      const orderNo = String(q.orderNo || '');
      const buyerCustomerId = String(q.buyerCustomerId || '');
      const payeeCustomerId = String(q.payeeCustomerId || '');
      if (!/^NC[A-Z0-9]+$/.test(orderNo)) throw new HttpError(400, '订单号无效');
      if (!/^QLC[A-Z0-9]+$/.test(buyerCustomerId) || !/^QLC[A-Z0-9]+$/.test(payeeCustomerId)) {
        throw new HttpError(400, '客户编号无效');
      }
      const subject = Array.from(String(q.subject || '作品')).slice(0, 40).join('');
      const existing = db.prepare('SELECT * FROM qinglan_trades WHERE order_no = ?').get(orderNo);
      if (existing && existing.amount_cents !== amountCents) throw new HttpError(409, '这笔订单的支付金额已经固定');
      if (!existing) {
        const tradeNo = `QL${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString('hex').toUpperCase()}`;
        db.prepare(`
          INSERT INTO qinglan_trades (
            trade_no, order_no, amount_cents, payout_cents, platform_fee_cents,
            buyer_customer_id, payee_customer_id, subject, notify_url, settle_url, return_url,
            status, settle_status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', 'unpaid', ?)
        `).run(
          tradeNo, orderNo, amountCents, payoutCents, platformFeeCents,
          buyerCustomerId, payeeCustomerId, subject, notifyUrl, settleUrl, returnUrl, Date.now(),
        );
      } else {
        db.prepare(`
          UPDATE qinglan_trades
          SET notify_url = ?, settle_url = ?, return_url = ?, subject = ?, payout_cents = ?, platform_fee_cents = ?
          WHERE order_no = ?
        `).run(notifyUrl, settleUrl, returnUrl, subject, payoutCents, platformFeeCents, orderNo);
      }
      const trade = db.prepare('SELECT * FROM qinglan_trades WHERE order_no = ?').get(orderNo);
      res.type('html').send(renderCheckout(trade));
    } catch (err) {
      next(err);
    }
  });

  app.post('/qinglan/api/pay', async (req, res, next) => {
    try {
      const orderNo = String(req.body?.orderNo || '');
      const trade = db.prepare('SELECT * FROM qinglan_trades WHERE order_no = ?').get(orderNo);
      if (!trade) throw new HttpError(404, '支付单不存在');
      if (trade.status === 'refunded') throw new HttpError(409, '这笔支付已退款');
      if (trade.status === 'created') {
        const now = Date.now();
        db.prepare(`
          UPDATE qinglan_trades
          SET status = 'paid', settle_status = 'pending_settlement', paid_at = ?
          WHERE trade_no = ? AND status = 'created'
        `).run(now, trade.trade_no);
      }
      const current = db.prepare('SELECT * FROM qinglan_trades WHERE trade_no = ?').get(trade.trade_no);
      const notified = await postNotify(current.notify_url, paidPayload(config, current));
      if (req.body?.back === 'wallet') {
        return res.redirect(`/qinglan/wallet?${walletQuery(req.body)}&notice=${notified ? 'synced' : 'retry'}`);
      }
      const back = new URL(current.return_url);
      if (!notified) back.searchParams.set('sync', 'retry');
      return res.redirect(back.toString());
    } catch (err) {
      next(err);
    }
  });

  app.post('/qinglan/api/refund', async (req, res, next) => {
    try {
      const customerId = assertWallet(config, req.body || {});
      const trade = db.prepare('SELECT * FROM qinglan_trades WHERE trade_no = ?').get(String(req.body.tradeNo || ''));
      if (!trade || trade.payee_customer_id !== customerId) throw new HttpError(404, '交易不存在');
      if (trade.status !== 'paid') throw new HttpError(409, '只有已支付的交易可以退款');
      db.prepare(`UPDATE qinglan_trades SET status = 'refunded' WHERE trade_no = ? AND status = 'paid'`).run(trade.trade_no);
      const current = db.prepare('SELECT * FROM qinglan_trades WHERE trade_no = ?').get(trade.trade_no);
      await postNotify(current.notify_url, refundPayload(config, current));
      res.redirect(`/qinglan/wallet?${walletQuery(req.body)}`);
    } catch (err) {
      next(err);
    }
  });

  app.post('/qinglan/api/settle', async (req, res, next) => {
    try {
      const customerId = assertWallet(config, req.body || {});
      const trade = db.prepare('SELECT * FROM qinglan_trades WHERE trade_no = ?').get(String(req.body.tradeNo || ''));
      if (!trade || trade.payee_customer_id !== customerId) throw new HttpError(404, '交易不存在');
      if (trade.status !== 'paid') throw new HttpError(409, '支付完成之后才能结算');
      if (trade.settle_status !== 'settled') {
        const now = Date.now();
        db.prepare(`
          UPDATE qinglan_trades SET settle_status = 'settled', settled_at = ?
          WHERE trade_no = ? AND status = 'paid' AND settle_status = 'pending_settlement'
        `).run(now, trade.trade_no);
      }
      const current = db.prepare('SELECT * FROM qinglan_trades WHERE trade_no = ?').get(trade.trade_no);
      await postNotify(current.settle_url, settlePayload(config, current));
      res.redirect(`/qinglan/wallet?${walletQuery(req.body)}`);
    } catch (err) {
      next(err);
    }
  });

  app.post('/qinglan/api/settlement/query', (req, res) => {
    const body = req.body || {};
    if (!verifyParams(config.sharedSecret, body) || body.merchantId !== config.merchantId || !freshTimestamp(body.timestamp, WINDOW_MS)) {
      return res.status(401).json({ error: '签名无效' });
    }
    const orderNo = String(body.orderNo || '');
    const trade = db.prepare('SELECT * FROM qinglan_trades WHERE order_no = ?').get(orderNo);
    let settleStatus = 'NONE';
    if (trade?.status === 'paid' && trade.settle_status === 'pending_settlement') settleStatus = 'PENDING';
    if (trade?.status === 'paid' && trade.settle_status === 'settled') settleStatus = 'SETTLED';
    if (trade?.status === 'refunded') settleStatus = 'REFUNDED';
    const payload = {
      merchantId: config.merchantId,
      orderNo,
      tradeNo: trade?.trade_no || '',
      amountCents: trade ? trade.amount_cents : '',
      settleStatus,
      timestamp: Date.now(),
    };
    if (trade?.settled_at) payload.settledAt = trade.settled_at;
    payload.sign = signParams(config.sharedSecret, payload);
    return res.json(payload);
  });

  app.get('/qinglan/wallet', (req, res, next) => {
    try {
      const customerId = assertWallet(config, req.query);
      res.type('html').send(renderWallet(db, customerId, req.query, String(req.query.notice || '')));
    } catch (err) {
      next(err);
    }
  });

  app.post('/qinglan/api/account', (req, res, next) => {
    try {
      const customerId = assertWallet(config, req.body || {});
      const accountName = String(req.body.accountName || '').trim();
      if (accountName.length < 2 || accountName.length > 40) throw new HttpError(400, '请填写 2 到 40 个字的开户名');
      const accountMask = maskAccount(req.body.accountNo);
      db.prepare(`
        INSERT INTO qinglan_accounts (customer_id, account_name, account_mask, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(customer_id) DO UPDATE SET
          account_name = excluded.account_name,
          account_mask = excluded.account_mask,
          updated_at = excluded.updated_at
      `).run(customerId, accountName, accountMask, Date.now());
      res.redirect(`/qinglan/wallet?${walletQuery(req.body)}`);
    } catch (err) {
      next(err);
    }
  });

  app.post('/qinglan/api/withdraw', (req, res, next) => {
    try {
      const customerId = assertWallet(config, req.body || {});
      const account = db.prepare('SELECT * FROM qinglan_accounts WHERE customer_id = ?').get(customerId);
      if (!account?.account_mask) throw new HttpError(400, '请先在青澜绑定结算账户');
      const amountCents = yuanTextToCents(req.body.amountYuan);
      if (!Number.isInteger(amountCents) || amountCents <= 0) throw new HttpError(400, '提现金额无效');
      const balance = balanceOf(db, customerId);
      if (amountCents > balance) throw new HttpError(400, '可提现余额不足');
      db.prepare('INSERT INTO qinglan_payouts (customer_id, amount_cents, created_at, note) VALUES (?, ?, ?, ?)').run(
        customerId,
        amountCents,
        Date.now(),
        '青澜演示打款，未连接银行',
      );
      res.redirect(`/qinglan/wallet?${walletQuery(req.body)}`);
    } catch (err) {
      next(err);
    }
  });

  app.use('/qinglan', (err, req, res, _next) => {
    const status = err.status || 500;
    const message = status >= 500 ? '青澜暂时无法完成操作' : err.message;
    if (wantsJson(req)) return res.status(status).json({ error: message });
    return res.status(status).type('html').send(qinglanPage({
      title: '青澜',
      body: `<section class="pay-card"><h1>没有完成</h1><p>${esc(message)}</p></section>`,
    }));
  });
}

function renderCheckout(trade) {
  const paid = trade.status === 'paid';
  const refunded = trade.status === 'refunded';
  return qinglanPage({
    title: '收银台 · 青澜',
    body: `
      <section class="pay-card">
        <p class="eyebrow">收银台</p>
        <h1>${esc(trade.subject)}</h1>
        <p class="pay-amount">${esc(formatCents(trade.amount_cents))}</p>
        <dl class="facts">
          <div><dt>订单号</dt><dd>${esc(trade.order_no)}</dd></div>
          <div><dt>青澜交易号</dt><dd>${esc(trade.trade_no)}</dd></div>
          <div><dt>作者所得</dt><dd>${esc(formatCents(trade.payout_cents))}</dd></div>
          <div><dt>平台分成</dt><dd>${esc(formatCents(trade.platform_fee_cents))}</dd></div>
          <div><dt>收款客户编号</dt><dd>${esc(trade.payee_customer_id)}</dd></div>
        </dl>
        <p class="note">确认支付后，青澜会用双方约定的密钥通知 NCstar。跳回 NCstar 只用于查看结果。</p>
        ${refunded ? '<p class="status-pill bad">已退款</p>' : ''}
        ${paid ? '<p class="status-pill ok">支付站已记录付款，可重新通知商户</p>' : ''}
        ${refunded ? '' : `
          <form method="post" action="/qinglan/api/pay">
            <input type="hidden" name="orderNo" value="${esc(trade.order_no)}">
            <button class="btn solid" type="submit">${paid ? '重新通知 NCstar' : '确认支付'}</button>
          </form>`}
        <p><a class="text-link" href="${esc(trade.return_url)}">取消并返回 NCstar</a></p>
      </section>`,
  });
}

function renderWallet(db, customerId, query, notice) {
  const account = db.prepare('SELECT * FROM qinglan_accounts WHERE customer_id = ?').get(customerId);
  const trades = db.prepare(`
    SELECT * FROM qinglan_trades WHERE payee_customer_id = ? ORDER BY created_at DESC
  `).all(customerId);
  const payouts = db.prepare(`
    SELECT * FROM qinglan_payouts WHERE customer_id = ? ORDER BY id DESC LIMIT 20
  `).all(customerId);
  const balance = balanceOf(db, customerId);
  const hidden = ['customerId', 'merchantId', 'timestamp', 'sign'].map((key) => (
    `<input type="hidden" name="${key}" value="${esc(query[key])}">`
  )).join('');
  const rows = trades.length ? trades.map((trade) => `
    <article class="trade">
      <header>
        <strong>${esc(trade.subject)}</strong>
        <span>${esc(trade.status === 'paid' ? '已支付' : trade.status === 'refunded' ? '已退款' : '待支付')}</span>
      </header>
      <p>${esc(trade.order_no)} · 实付 ${esc(formatCents(trade.amount_cents))} · 作者所得 ${esc(formatCents(trade.payout_cents))}</p>
      <p>结算：${esc(trade.settle_status === 'settled' ? '已结算' : trade.status === 'paid' ? '待结算' : '未支付')}</p>
      <div class="row-actions">
        ${trade.status === 'paid' ? `
          <form method="post" action="/qinglan/api/settle">${hidden}<input type="hidden" name="tradeNo" value="${esc(trade.trade_no)}"><button class="btn small" type="submit">结算并通知</button></form>
          <form method="post" action="/qinglan/api/pay">${hidden}<input type="hidden" name="orderNo" value="${esc(trade.order_no)}"><input type="hidden" name="back" value="wallet"><button class="btn small ghost" type="submit">重发支付通知</button></form>
          <form method="post" action="/qinglan/api/refund">${hidden}<input type="hidden" name="tradeNo" value="${esc(trade.trade_no)}"><button class="btn small danger" type="submit">退款</button></form>
        ` : ''}
      </div>
    </article>`).join('') : '<p class="note">还没有收到付给这个客户编号的交易。</p>';
  const payoutRows = payouts.length ? `<ul class="plain">${payouts.map((item) => `<li>${esc(formatTime(item.created_at))} 打款 ${esc(formatCents(item.amount_cents))}</li>`).join('')}</ul>` : '<p class="note">还没有打款记录。</p>';
  return qinglanPage({
    title: '钱包 · 青澜',
    body: `
      <section class="pay-card">
        <p class="eyebrow">已绑定客户编号</p>
        <h1>${esc(customerId)}</h1>
        <p>结算账户、提现和打款都在青澜办理。NCstar 用的是同一个客户编号，但只展示账本。</p>
        ${notice === 'retry' ? '<p class="note">刚才没有通知到 NCstar，可以再发一次。</p>' : ''}
        <p class="pay-amount">${esc(formatCents(balance))}</p>
        <p class="note">可提现余额来自已结算且未退款交易里的作者所得。</p>
      </section>
      <section class="pay-card">
        <h2>结算账户</h2>
        ${account?.account_mask ? `<p>已绑定 ${esc(account.account_name)} ${esc(account.account_mask)}</p>` : '<p class="note">还没有绑定。账号全文不会被保存，只留下后四位。</p>'}
        <form method="post" action="/qinglan/api/account" class="stack">
          ${hidden}
          <label>开户名<input name="accountName" maxlength="40" required value="${esc(account?.account_name || '')}"></label>
          <label>银行账号<input name="accountNo" inputmode="numeric" required placeholder="仅用于生成掩码"></label>
          <button class="btn solid" type="submit">保存在青澜</button>
        </form>
      </section>
      <section class="pay-card">
        <h2>提现 / 打款</h2>
        <form method="post" action="/qinglan/api/withdraw" class="stack">
          ${hidden}
          <label>金额（元）<input name="amountYuan" inputmode="decimal" required placeholder="0.00"></label>
          <button class="btn solid" type="submit">由青澜打款</button>
        </form>
        ${payoutRows}
      </section>
      <section class="pay-card">
        <h2>交易</h2>
        ${rows}
      </section>`,
  });
}
