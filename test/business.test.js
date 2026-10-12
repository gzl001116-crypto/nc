import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { hashPassword } from '../src/authlib.js';
import { createWork, publishDue, recordView, toggleLike } from '../src/catalog.js';
import { makeConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { formatCents, splitFee, yuanTextToCents } from '../src/money.js';
import { signParams } from '../src/sign.js';
import { createApp } from '../src/app.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function cookieJar(base) {
  let cookie = '';
  return {
    async fetch(url, options = {}) {
      const headers = { ...(options.headers || {}) };
      if (cookie) headers.cookie = cookie;
      const target = String(url).startsWith('http') ? url : base + url;
      const res = await fetch(target, { ...options, headers, redirect: options.redirect || 'manual' });
      for (const item of res.headers.getSetCookie?.() || []) {
        const pair = item.split(';')[0];
        if (pair.startsWith('ncstar_sid=')) cookie = pair;
      }
      return res;
    },
  };
}

async function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

describe('金额', () => {
  it('把元换成分，并拒绝小数误差', () => {
    assert.equal(yuanTextToCents('12.50'), 1250);
    assert.equal(yuanTextToCents('12.5'), 1250);
    assert.equal(yuanTextToCents('0.01'), 1);
    assert.equal(yuanTextToCents('0'), 0);
    assert.equal(formatCents(1250), '¥12.50');
    assert.equal(formatCents(1), '¥0.01');
    assert.throws(() => yuanTextToCents('12.501'));
    assert.throws(() => yuanTextToCents('1e2'));
    assert.throws(() => yuanTextToCents('-1'));
    const split = splitFee(1001, 2000);
    assert.deepEqual(split, { platformFeeCents: 200, authorCents: 801 });
  });
});

describe('NCstar', () => {
  let db;
  let config;
  let server;
  let base;
  let author;
  let buyer;
  const password = 'password-8';

  before(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ncstar-'));
    const uploadDir = path.join(dir, 'uploads');
    fs.mkdirSync(uploadDir, { recursive: true });
    db = openDatabase(path.join(dir, 'ncstar.db'));
    config = makeConfig({
      dataDir: dir,
      uploadDir,
      dbFile: path.join(dir, 'ncstar.db'),
      seed: false,
      scheduler: false,
      codeCooldownMs: 0,
      devMailbox: true,
      sharedSecret: 'test-secret',
      platformFeeBps: 2000,
    });
    const app = createApp({ db, config });
    server = await listen(app);
    base = `http://127.0.0.1:${server.address().port}`;
    config.publicBaseUrl = base;
    config.qinglanBaseUrl = `${base}/qinglan`;
    author = cookieJar(base);
    buyer = cookieJar(base);
    await register(author, 'author@test.local', '作者甲');
    await register(buyer, 'buyer@test.local', '读者乙');
  });

  after(async () => {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    db.close();
  });

  async function register(client, email, nickname) {
    const sent = await client.fetch('/api/auth/send-code', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email, purpose: 'register' }),
    });
    assert.equal(sent.status, 200);
    const code = db.prepare('SELECT code FROM mailbox WHERE email = ? ORDER BY id DESC LIMIT 1').get(email).code;
    const res = await client.fetch('/api/auth/register', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email, code, password, nickname }),
    });
    assert.equal(res.status, 201);
    return res.json();
  }

  async function publishNovel(client, fields) {
    const form = new FormData();
    form.set('type', 'novel');
    form.set('title', fields.title);
    form.set('summary', fields.summary || '摘要');
    form.set('priceCents', String(fields.priceCents));
    form.set('previewMode', fields.previewMode);
    if (fields.previewPercent) form.set('previewPercent', String(fields.previewPercent));
    form.set('previewText', fields.previewText || '');
    form.set('body', fields.body);
    form.set('publishMode', fields.publishMode || 'now');
    if (fields.publishAt) form.set('publishAt', String(fields.publishAt));
    const res = await client.fetch('/api/works', {
      method: 'POST',
      headers: { accept: 'application/json' },
      body: form,
    });
    const data = await res.json();
    assert.equal(res.status, 201, data.error);
    return data;
  }

  it('注册和登录都要验证码', async () => {
    const missing = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 'buyer@test.local', password, code: '' }),
    });
    assert.equal(missing.status, 400);
    const stranger = cookieJar(base);
    const bad = await stranger.fetch('/api/auth/register', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 'new@test.local', password, nickname: '新人', code: '000000' }),
    });
    assert.equal(bad.status, 400);
  });

  it('未登录不计浏览，同一账号只记一次', async () => {
    const created = await publishNovel(author, {
      title: '浏览计数',
      priceCents: 0,
      previewMode: 'content',
      previewText: '预览文字',
      body: '正文足够长，用来确认浏览计数不会因为刷新增加。',
    });
    const anon = await fetch(`${base}/works/${created.id}`);
    assert.equal(anon.status, 200);
    const anonView = await fetch(`${base}/api/works/${created.id}/view`, { method: 'POST' });
    assert.equal(anonView.status, 401);
    const first = await buyer.fetch(`/api/works/${created.id}/view`, { method: 'POST', headers: { accept: 'application/json' } });
    assert.deepEqual(await first.json(), { counted: true, viewCount: 1 });
    const second = await buyer.fetch(`/api/works/${created.id}/view`, { method: 'POST', headers: { accept: 'application/json' } });
    assert.deepEqual(await second.json(), { counted: false, viewCount: 1 });
    const page = await buyer.fetch(`/works/${created.id}`);
    assert.equal(page.status, 200);
    const count = db.prepare('SELECT view_count FROM works WHERE id = ?').get(created.id).view_count;
    assert.equal(count, 1);
  });

  it('热度按赞览比排序，浏览不超过 100 的不显示', () => {
    const authorRow = db.prepare('SELECT id FROM users WHERE email = ?').get('author@test.local');
    const hash = hashPassword(password);
    const insertUser = db.prepare(`
      INSERT INTO users (email, password_hash, nickname, qinglan_customer_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const viewers = [];
    for (let i = 0; i < 200; i += 1) {
      viewers.push(Number(insertUser.run(`heat${i}@test.local`, hash, `热${i}`, `QLCHEAT${String(i).padStart(4, '0')}`, Date.now()).lastInsertRowid));
    }
    const low = createWork(db, authorRow.id, novelInput('高赞未满百', 1000), {});
    const mid = createWork(db, authorRow.id, novelInput('中等热度', 1100), {});
    const high = createWork(db, authorRow.id, novelInput('更高热度', 1200), {});
    for (let i = 0; i < 100; i += 1) recordView(db, viewers[i], low.id);
    for (let i = 0; i < 101; i += 1) recordView(db, viewers[i], mid.id);
    for (let i = 0; i < 200; i += 1) recordView(db, viewers[i], high.id);
    for (let i = 0; i < 80; i += 1) toggleLike(db, viewers[i], low.id);
    for (let i = 0; i < 50; i += 1) toggleLike(db, viewers[i], mid.id);
    for (let i = 0; i < 20; i += 1) toggleLike(db, viewers[i], high.id);
    const rows = db.prepare(`
      SELECT id, title FROM works
      WHERE status = 'published' AND view_count > 100
      ORDER BY (like_count * 1.0 / view_count) DESC, like_count DESC, id DESC
    `).all();
    const titles = rows.map((row) => row.title);
    assert.equal(titles.includes('高赞未满百'), false);
    assert.ok(titles.indexOf('中等热度') < titles.indexOf('更高热度'));
    return fetch(`${base}/api/works?sort=heat`, { headers: { accept: 'application/json' } })
      .then((res) => res.json())
      .then((data) => {
        const names = data.works.map((work) => work.title);
        assert.equal(names.includes('高赞未满百'), false);
        assert.equal(names.includes('浏览计数'), false);
        assert.ok(names.indexOf('中等热度') < names.indexOf('更高热度'));
        assert.ok(data.works.every((work) => work.viewCount > 100));
      });
  });

  it('预览进度和预览内容都不会泄漏未购买正文', async () => {
    const marker = '泄漏标记不应出现';
    const progressBody = `${'甲'.repeat(30)}${marker}`;
    const progress = await publishNovel(author, {
      title: '进度预览',
      priceCents: 800,
      previewMode: 'progress',
      previewPercent: 20,
      body: progressBody,
    });
    const progressJson = await (await fetch(`${base}/api/works/${progress.id}`, { headers: { accept: 'application/json' } })).json();
    assert.equal(progressJson.work.body, '甲'.repeat(Math.floor(Array.from(progressBody).length * 0.2)));
    assert.equal(JSON.stringify(progressJson).includes(marker), false);

    const content = await publishNovel(author, {
      title: '内容预览',
      priceCents: 900,
      previewMode: 'content',
      previewText: '只看这段预览',
      body: `这是不应该被预览看到的正文${marker}`,
    });
    const contentJson = await (await fetch(`${base}/api/works/${content.id}`, { headers: { accept: 'application/json' } })).json();
    assert.equal(contentJson.work.body, '');
    assert.equal(contentJson.work.previewText, '只看这段预览');
    assert.equal(JSON.stringify(contentJson).includes(marker), false);
  });

  it('漫画按进度只给出允许的页', async () => {
    const form = new FormData();
    form.set('type', 'comic');
    form.set('title', '四页漫画');
    form.set('summary', '页数预览');
    form.set('priceCents', '1600');
    form.set('previewMode', 'progress');
    form.set('previewPercent', '50');
    form.set('body', '');
    form.set('publishMode', 'now');
    for (let i = 0; i < 4; i += 1) form.append('pages', new File([PNG], `p${i}.png`, { type: 'image/png' }));
    const createdRes = await author.fetch('/api/works', { method: 'POST', headers: { accept: 'application/json' }, body: form });
    const created = await createdRes.json();
    assert.equal(createdRes.status, 201, created.error);
    const seen = await (await fetch(`${base}/api/works/${created.id}`, { headers: { accept: 'application/json' } })).json();
    assert.equal(seen.work.pages.length, 2);
    const assets = db.prepare('SELECT id FROM work_assets WHERE work_id = ? ORDER BY sort_order').all(created.id);
    const hidden = await fetch(`${base}/media/works/${created.id}/pages/${assets[2].id}`);
    assert.equal(hidden.status, 403);
    const open = await fetch(`${base}/media/works/${created.id}/pages/${assets[0].id}`);
    assert.equal(open.status, 200);
  });

  it('定时投稿到点之前不出现在书库', async () => {
    const created = await publishNovel(author, {
      title: '尚未到点',
      priceCents: 500,
      previewMode: 'content',
      previewText: '还没公开',
      body: '这段正文要等定时投稿到点之后才能在书库看到。',
      publishMode: 'schedule',
      publishAt: Date.now() + 60_000,
    });
    const listed = await (await fetch(`${base}/api/works?sort=latest`, { headers: { accept: 'application/json' } })).json();
    assert.equal(listed.works.some((work) => work.id === created.id), false);
    const hidden = await fetch(`${base}/works/${created.id}`);
    assert.equal(hidden.status, 404);
    const own = await author.fetch(`/api/works/${created.id}`, { headers: { accept: 'application/json' } });
    assert.equal(own.status, 200);
    assert.equal(publishDue(db, Date.now() + 120_000), 1);
    const shown = await (await fetch(`${base}/api/works?sort=latest`, { headers: { accept: 'application/json' } })).json();
    assert.equal(shown.works.some((work) => work.id === created.id), true);
  });

  it('下单不收款，只有验签回调能入账，而且只入账一次', async () => {
    const created = await publishNovel(author, {
      title: '付费信件',
      priceCents: 1500,
      previewMode: 'content',
      previewText: '购买前的预览',
      body: '购买之后才能阅读的完整信件，这里把话说到二十个字以上。',
    });
    const own = await author.fetch('/api/orders', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ workId: created.id }),
    });
    assert.equal(own.status, 400);

    const orderRes = await buyer.fetch('/api/orders', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ workId: created.id }),
    });
    const createdOrder = await orderRes.json();
    assert.equal(orderRes.status, 201);
    assert.equal(createdOrder.order.status, 'pending');
    assert.equal(createdOrder.order.amountCents, 1500);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM ledger').get().total, 0);

    const result = await buyer.fetch(`/orders/${createdOrder.order.orderNo}/result?tradeStatus=PAID`);
    assert.equal(result.status, 200);
    const resultHtml = await result.text();
    assert.match(resultHtml, /待支付/);
    assert.equal(db.prepare('SELECT status FROM orders WHERE order_no = ?').get(createdOrder.order.orderNo).status, 'pending');

    const bad = await fetch(`${base}/api/payments/qinglan/notify`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ ...paidPayload(createdOrder.order.orderNo, 1500), sign: 'bad' }),
    });
    assert.equal(bad.status, 401);
    const mismatch = await fetch(`${base}/api/payments/qinglan/notify`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(paidPayload(createdOrder.order.orderNo, 1501)),
    });
    assert.equal(mismatch.status, 400);
    assert.equal(db.prepare('SELECT status FROM orders WHERE order_no = ?').get(createdOrder.order.orderNo).status, 'pending');

    const payload = paidPayload(createdOrder.order.orderNo, 1500);
    const [first, second] = await Promise.all([
      fetch(`${base}/api/payments/qinglan/notify`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(payload) }),
      fetch(`${base}/api/payments/qinglan/notify`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(payload) }),
    ]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const flags = [await first.json(), await second.json()].map((item) => item.duplicate).sort();
    assert.deepEqual(flags, [false, true]);
    const ledger = db.prepare('SELECT * FROM ledger').all();
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].gross_cents, 1500);
    assert.equal(ledger[0].platform_fee_cents, 300);
    assert.equal(ledger[0].author_cents, 1200);
    assert.equal(ledger[0].status, 'pending_settlement');
    const again = await fetch(`${base}/api/payments/qinglan/notify`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(paidPayload(createdOrder.order.orderNo, 1500)),
    });
    assert.equal((await again.json()).duplicate, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM ledger').get().total, 1);
  });

  it('支付站跳转本身不改状态；回调、查询和提现各自守住边界', async () => {
    const created = await publishNovel(author, {
      title: '青澜往返',
      priceCents: 2500,
      previewMode: 'progress',
      previewPercent: 10,
      body: '这一篇要经过青澜收银台，再由签名通知改成已支付。',
    });
    const orderRes = await buyer.fetch('/api/orders', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ workId: created.id }),
    });
    const { order, payUrl } = await orderRes.json();
    const params = new URLSearchParams({
      merchantId: 'ncstar',
      orderNo: order.orderNo,
      amountCents: String(order.amountCents),
      payoutCents: '2000',
      platformFeeCents: '500',
      subject: '青澜往返',
      buyerCustomerId: db.prepare('SELECT qinglan_customer_id FROM users WHERE email = ?').get('buyer@test.local').qinglan_customer_id,
      payeeCustomerId: db.prepare('SELECT qinglan_customer_id FROM users WHERE email = ?').get('author@test.local').qinglan_customer_id,
      notifyUrl: 'http://127.0.0.1:9/nope',
      settleUrl: `${base}/api/payments/qinglan/settlement`,
      returnUrl: `${base}/orders/${order.orderNo}/result`,
      timestamp: String(Date.now()),
    });
    params.set('sign', signParams(config.sharedSecret, Object.fromEntries(params)));
    const badCheckout = await fetch(`${base}/qinglan/checkout?${params}`);
    assert.equal(badCheckout.status, 200);
    const missed = await fetch(`${base}/qinglan/api/pay`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ orderNo: order.orderNo }),
      redirect: 'manual',
    });
    assert.equal(missed.status, 302);
    assert.equal(db.prepare('SELECT status FROM orders WHERE order_no = ?').get(order.orderNo).status, 'pending');

    const checkout = await fetch(payUrl);
    assert.equal(checkout.status, 200);
    assert.match(await checkout.text(), /重新通知|确认支付/);
    const paid = await fetch(`${base}/qinglan/api/pay`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ orderNo: order.orderNo }),
      redirect: 'manual',
    });
    assert.equal(paid.status, 302);
    assert.equal(db.prepare('SELECT status FROM orders WHERE order_no = ?').get(order.orderNo).status, 'paid');
    assert.equal(db.prepare(`SELECT COUNT(*) AS total FROM ledger JOIN orders ON orders.id = ledger.order_id WHERE orders.order_no = ?`).get(order.orderNo).total, 1);

    const income = await author.fetch('/me/income');
    const incomeHtml = await income.text();
    assert.match(incomeHtml, /待结算/);
    const walletHref = incomeHtml.match(/href="([^"]*\/qinglan\/wallet\?[^"]+)"/)[1].replaceAll('&amp;', '&');
    const wallet = await fetch(walletHref);
    assert.equal(wallet.status, 200);
    const walletHtml = await wallet.text();
    assert.match(walletHtml, /已绑定客户编号|QLC/);
    assert.match(walletHtml, /不向银行卡|不会向银行卡|NCstar 用的是同一个客户编号/);

    const sync = await author.fetch('/api/income/sync-settlement', { method: 'POST', headers: jsonHeaders(), body: '{}' });
    assert.equal(sync.status, 200);
    assert.equal(db.prepare(`SELECT ledger.status FROM ledger JOIN orders ON orders.id = ledger.order_id WHERE orders.order_no = ?`).get(order.orderNo).status, 'pending_settlement');

    const token = Object.fromEntries(new URL(walletHref).searchParams);
    const tradeNo = db.prepare('SELECT trade_no FROM qinglan_trades WHERE order_no = ?').get(order.orderNo).trade_no;
    const settle = await fetch(`${base}/qinglan/api/settle`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...token, tradeNo }),
      redirect: 'manual',
    });
    assert.equal(settle.status, 302);
    assert.equal(db.prepare(`SELECT ledger.status FROM ledger JOIN orders ON orders.id = ledger.order_id WHERE orders.order_no = ?`).get(order.orderNo).status, 'settled');
    const settleAgain = await fetch(`${base}/qinglan/api/settle`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...token, tradeNo }),
      redirect: 'manual',
    });
    assert.equal(settleAgain.status, 302);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM ledger').get().total >= 1, true);
    const settledRows = db.prepare(`SELECT ledger.status FROM ledger JOIN orders ON orders.id = ledger.order_id WHERE orders.order_no = ?`).all(order.orderNo);
    assert.equal(settledRows.length, 1);

    const account = await fetch(`${base}/qinglan/api/account`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...token, accountName: '林昭', accountNo: '6222021234567890123' }),
      redirect: 'manual',
    });
    assert.equal(account.status, 302);
    const withdraw = await fetch(`${base}/qinglan/api/withdraw`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...token, amountYuan: '1.00' }),
      redirect: 'manual',
    });
    assert.equal(withdraw.status, 302);
    const after = db.prepare(`SELECT ledger.author_cents, ledger.status FROM ledger JOIN orders ON orders.id = ledger.order_id WHERE orders.order_no = ?`).get(order.orderNo);
    assert.equal(after.author_cents, 2000);
    assert.equal(after.status, 'settled');
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM qinglan_payouts').get().total, 1);
    const summary = await (await author.fetch('/api/income', { headers: { accept: 'application/json' } })).json();
    const row = summary.summary.find((item) => item.title === '青澜往返');
    assert.equal(row.paid_cents, 2500);
    assert.equal(row.pending_cents, 0);
    assert.equal(row.settled_cents, 2000);
  });

  it('退款回调只冲回一次待结算收入', async () => {
    const created = await publishNovel(author, {
      title: '可退款',
      priceCents: 1000,
      previewMode: 'content',
      previewText: '预览',
      body: '这篇用来确认退款之后，待结算的作者收入只会被冲回一次。',
    });
    const { order } = await (await buyer.fetch('/api/orders', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ workId: created.id }),
    })).json();
    const paid = await fetch(`${base}/api/payments/qinglan/notify`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(paidPayload(order.orderNo, 1000)),
    });
    assert.equal(paid.status, 200);
    const refund = await fetch(`${base}/api/payments/qinglan/notify`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(refundPayload(order.orderNo, 1000)),
    });
    assert.equal(refund.status, 200);
    const again = await fetch(`${base}/api/payments/qinglan/notify`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(refundPayload(order.orderNo, 1000)),
    });
    assert.equal((await again.json()).duplicate, true);
    const row = db.prepare(`
      SELECT orders.status AS order_status, ledger.status AS ledger_status
      FROM orders JOIN ledger ON ledger.order_id = orders.id
      WHERE orders.order_no = ?
    `).get(order.orderNo);
    assert.equal(row.order_status, 'refunded');
    assert.equal(row.ledger_status, 'reversed');
  });

  function paidPayload(orderNo, amountCents) {
    const payload = {
      merchantId: 'ncstar',
      orderNo,
      tradeNo: `QLTEST${orderNo.slice(-6)}`,
      amountCents,
      tradeStatus: 'PAID',
      timestamp: Date.now(),
    };
    payload.sign = signParams(config.sharedSecret, payload);
    return payload;
  }

  function refundPayload(orderNo, amountCents) {
    const payload = {
      merchantId: 'ncstar',
      orderNo,
      tradeNo: `QLTEST${orderNo.slice(-6)}`,
      amountCents,
      tradeStatus: 'REFUNDED',
      timestamp: Date.now(),
    };
    payload.sign = signParams(config.sharedSecret, payload);
    return payload;
  }
});

function jsonHeaders() {
  return { accept: 'application/json', 'content-type': 'application/json' };
}

function novelInput(title, priceCents) {
  return {
    type: 'novel',
    title,
    summary: '热度测试',
    priceCents,
    previewMode: 'content',
    previewText: '预览',
    body: '这段正文用来占据一部已发布的小说，方便统计浏览和点赞。',
    publishMode: 'now',
  };
}
