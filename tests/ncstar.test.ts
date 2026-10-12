import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import test from "node:test";
import { issueEmailCode, loginUser, registerUser } from "../lib/auth";
import { openDatabase, one, run, type DB } from "../lib/db";
import { gatewayPay, gatewayQuery, gatewayReturnOnly, gatewaySettle, openCheckout } from "../lib/gateway";
import { formatCents, splitAmount, yuanToCents } from "../lib/money";
import {
  createOrder,
  handlePaymentNotify,
  handleSettlementNotify,
  incomeByWork,
  listLedger,
  readReturnState,
  syncAuthorSettlements,
} from "../lib/orders";
import { showChapters, type StoredChapter } from "../lib/preview";
import { signParams } from "../lib/sign";
import { createWork, listAuthorWorks, listPublished, recordView } from "../lib/works";

const SECRET = "test-secret";
const PEPPER = "test-pepper";
const URLS = {
  paymentBaseUrl: "http://localhost:3000/station",
  appBaseUrl: "http://localhost:3000",
  secret: SECRET,
};

function tempDb(): DB {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ncstar-"));
  return openDatabase(path.join(dir, "test.sqlite"));
}

function addUser(db: DB, email: string, name = email, customer: string | null = null): number {
  run(
    db,
    `INSERT INTO users (email, password_hash, display_name, customer_no, created_at) VALUES (?, 'x', ?, ?, 1)`,
    email,
    name,
    customer,
  );
  return one<{ id: number }>(db, `SELECT id FROM users WHERE email = ?`, email)!.id;
}

function novel(db: DB, authorId: number, title: string, priceCents = 1230, publishAt: number | null = null): number {
  return createWork(db, authorId, {
    type: "novel",
    title,
    summary: `${title} 的简介`,
    coverPath: null,
    priceCents,
    previewMode: "progress",
    previewPercent: 30,
    publishAt,
    chapters: [
      { title: "一", body: "一二三四五六七八九十", mediaPath: null, isPreview: false },
      { title: "二", body: "第二段全文不应该在预览外泄露", mediaPath: null, isPreview: false },
    ],
    now: 1_700_000_000_000,
  });
}

test("金额用整数分换算，不走二进制小数", () => {
  assert.equal(yuanToCents("0.10"), 10);
  assert.equal(yuanToCents("0.29"), 29);
  assert.equal(yuanToCents("10.10"), 1010);
  assert.equal(yuanToCents("12.3"), 1230);
  assert.equal(yuanToCents("12.345"), null);
  assert.equal(yuanToCents("1e2"), null);
  assert.equal(formatCents(10), "0.10");
  assert.equal(formatCents(1010), "10.10");
  assert.equal(formatCents(1230), "12.30");
  const split = splitAmount(199, 1000);
  assert.equal(split.platformFeeCents, 19);
  assert.equal(split.authorCents, 180);
  assert.equal(split.platformFeeCents + split.authorCents, 199);
});

test("邮箱验证码注册和登录", async () => {
  const db = tempDb();
  const now = 1_700_000_000_000;
  await issueEmailCode(db, "Author@Example.com", "register", PEPPER, now);
  const body = one<{ body: string }>(db, `SELECT body FROM mailbox WHERE email = ?`, "author@example.com")!.body;
  const code = /验证码是 (\d{6})/.exec(body)?.[1];
  assert.ok(code);
  const registered = registerUser(
    db,
    { email: "author@example.com", password: "password1", displayName: "作者", code: code! },
    PEPPER,
    4,
    now,
  );
  assert.equal(registered.user.display_name, "作者");
  assert.throws(
    () =>
      registerUser(
        db,
        { email: "author@example.com", password: "password1", displayName: "作者", code: code! },
        PEPPER,
        4,
        now,
      ),
    /已注册/,
  );

  await issueEmailCode(db, "author@example.com", "login", PEPPER, now + 120_000);
  const loginBody = one<{ body: string }>(
    db,
    `SELECT body FROM mailbox WHERE email = ? ORDER BY id DESC LIMIT 1`,
    "author@example.com",
  )!.body;
  const loginCode = /验证码是 (\d{6})/.exec(loginBody)![1];
  const logged = loginUser(db, { email: "author@example.com", password: "password1", code: loginCode }, PEPPER, now + 120_000);
  assert.equal(logged.user.id, registered.user.id);
});

test("预览可以选择进度或指定内容，未购买时不泄露正文", () => {
  const chapters: StoredChapter[] = [
    { id: 1, title: "一", body: "一二三四五六七八九十", media_path: null, sort_index: 0, is_preview: 0 },
    { id: 2, title: "二", body: "隐藏的第二段", media_path: null, sort_index: 1, is_preview: 1 },
  ];
  const progress = showChapters(chapters, { type: "novel", previewMode: "progress", previewPercent: 30, unlocked: false });
  assert.equal(progress[0].level, "partial");
  assert.equal(progress[0].text, "一二三");
  assert.equal(progress[1].text, null);
  assert.equal(JSON.stringify(progress).includes("隐藏的第二段"), false);

  const content = showChapters(chapters, { type: "novel", previewMode: "content", previewPercent: 0, unlocked: false });
  assert.equal(content[0].level, "locked");
  assert.equal(content[0].text, null);
  assert.equal(content[1].level, "full");
  assert.equal(content[1].text, "隐藏的第二段");

  const full = showChapters(chapters, { type: "novel", previewMode: "progress", previewPercent: 30, unlocked: true });
  assert.equal(full.every((chapter) => chapter.level === "full"), true);
});

test("定时投稿到期前不公开，浏览只计登录账号一次", () => {
  const db = tempDb();
  const author = addUser(db, "a@t.test", "作者", "CST1");
  const reader = addUser(db, "b@t.test", "读者");
  const now = 1_700_000_000_000;
  const later = novel(db, author, "未到点", 100, now + 120_000);
  assert.equal(listPublished(db, { sort: "latest", type: null, now }).some((work) => work.id === later), false);
  assert.equal(listAuthorWorks(db, author, now).some((work) => work.id === later && work.status === "scheduled"), true);
  assert.equal(recordView(db, reader, later, now).counted, false);
  assert.equal(listPublished(db, { sort: "latest", type: null, now: now + 130_000 }).some((work) => work.id === later), true);

  const live = novel(db, author, "已发布", 100);
  assert.equal(recordView(db, null, live, now).counted, false);
  assert.equal(recordView(db, reader, live, now).counted, true);
  assert.equal(recordView(db, reader, live, now).counted, false);
  assert.equal(recordView(db, reader, live, now).viewCount, 1);
});

test("热度按点赞人数除以浏览人数排序，浏览不超过 100 的不显示", () => {
  const db = tempDb();
  const author = addUser(db, "heat@t.test", "作者", "CSTHEAT");
  const pool = Array.from({ length: 200 }, (_, index) => addUser(db, `p${index}@t.test`, `读者${index}`));
  const works = {
    low: novel(db, author, "刚好一百"),
    mid: novel(db, author, "一百零一"),
    high: novel(db, author, "高热度"),
    steady: novel(db, author, "中热度"),
  };
  mark(works.low, 100, 99);
  mark(works.mid, 101, 50);
  mark(works.high, 150, 90);
  mark(works.steady, 200, 80);

  const heat = listPublished(db, { sort: "heat", type: null }).map((work) => work.title);
  assert.deepEqual(heat, ["高热度", "一百零一", "中热度"]);
  const latest = listPublished(db, { sort: "latest", type: null }).map((work) => work.title);
  assert.equal(latest.includes("刚好一百"), true);

  function mark(workId: number, views: number, likes: number) {
    for (let index = 0; index < views; index += 1) {
      run(db, `INSERT INTO work_views (user_id, work_id, created_at) VALUES (?, ?, 1)`, pool[index], workId);
    }
    for (let index = 0; index < likes; index += 1) {
      run(db, `INSERT INTO work_likes (user_id, work_id, created_at) VALUES (?, ?, 1)`, pool[index], workId);
    }
  }
});

test("下单不收款，只有验签回调才入账，重复回调只记一次", async () => {
  const db = tempDb();
  const now = 1_700_000_000_000;
  const author = addUser(db, "author@t.test", "作者", "CST10001");
  const buyer = addUser(db, "buyer@t.test", "买家");
  const workId = novel(db, author, "星海手记", 199);
  const created = createOrder(db, buyer, workId, URLS, now);
  assert.equal(created.order.status, "pending");
  assert.equal(created.order.amount_cents, 199);
  assert.equal(listLedger(db, author).length, 0);
  const checkout = new URL(created.payUrl);
  const params = Object.fromEntries(checkout.searchParams);
  assert.equal(openCheckout(db, params, SECRET, URLS.appBaseUrl, now).ok, true);

  const returned = gatewayReturnOnly(db, created.order.order_no, URLS.appBaseUrl);
  const forged = new URL(returned.redirect);
  const before = readReturnState(db, created.order.order_no, Object.fromEntries(forged.searchParams));
  assert.equal(before.forged, true);
  assert.equal(before.order?.status, "pending");
  assert.equal(one<{ status: string }>(db, `SELECT status FROM orders WHERE order_no = ?`, created.order.order_no)!.status, "pending");

  const pay = await gatewayPay(db, created.order.order_no, SECRET, URLS.appBaseUrl, notifyFetcher("paid"), now);
  assert.equal(pay.notifyStatus, 200);
  assert.equal(one<{ status: string }>(db, `SELECT status FROM orders WHERE id = ?`, created.order.id)!.status, "paid");
  assert.equal(listLedger(db, author).length, 1);
  const entry = listLedger(db, author)[0];
  assert.equal(entry.gross_cents, 199);
  assert.equal(entry.platform_fee_cents, 19);
  assert.equal(entry.author_cents, 180);
  assert.equal(entry.settlement_status, "pending");

  const again = await gatewayPay(db, created.order.order_no, SECRET, URLS.appBaseUrl, notifyFetcher("paid"), now + 1000);
  assert.equal(again.notifyStatus, 200);
  assert.equal(listLedger(db, author).length, 1);
  assert.equal(incomeByWork(db, author)[0].paid_cents, 199);
  assert.equal(incomeByWork(db, author)[0].pending_cents, 180);

  const bad = handlePaymentNotify(db, { ...signedPaid(created.order.order_no, 200, now), sign: "0".repeat(64) }, SECRET, 1000, now);
  assert.equal(bad.ok, false);
  const mismatch = handlePaymentNotify(db, signedPaid(created.order.order_no, 200, now), SECRET, 1000, now);
  assert.equal(mismatch.ok, false);

  const earlySettle = handleSettlementNotify(db, signedSettlement("NO-SUCH", now), SECRET, now);
  assert.equal(earlySettle.ok, false);

  function notifyFetcher(kind: "paid" | "refunded"): typeof fetch {
    return (async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const result = kind === "refunded"
        ? handlePaymentNotify(db, payload, SECRET, 1000, now)
        : handlePaymentNotify(db, payload, SECRET, 1000, Number(payload.timestamp) || now);
      return new Response(JSON.stringify(result), { status: result.ok ? 200 : result.status });
    }) as typeof fetch;
  }

  function signedPaid(orderNo: string, amount: number, timestamp: number) {
    const payload = {
      order_no: orderNo,
      trade_no: "T1",
      amount_cents: String(amount),
      status: "paid",
      timestamp: String(timestamp),
    };
    return { ...payload, amount_cents: amount, timestamp, sign: signParams(payload, SECRET) };
  }

  function signedSettlement(orderNo: string, timestamp: number) {
    const payload = { order_no: orderNo, settlement_status: "settled", timestamp: String(timestamp) };
    return { ...payload, timestamp, sign: signParams(payload, SECRET) };
  }
});

test("查询和结算通知只改结算，不把未回调的订单改成已支付", async () => {
  const db = tempDb();
  const now = 1_700_000_000_000;
  const author = addUser(db, "author2@t.test", "作者", "CST10002");
  const buyer = addUser(db, "buyer2@t.test", "买家");
  const workId = novel(db, author, "退款与结算", 1000);
  const created = createOrder(db, buyer, workId, URLS, now);
  const params = Object.fromEntries(new URL(created.payUrl).searchParams);
  assert.equal(openCheckout(db, params, SECRET, URLS.appBaseUrl, now).ok, true);

  const untouched = await syncAuthorSettlements(db, author, {
    paymentBaseUrl: URLS.paymentBaseUrl,
    secret: SECRET,
    now,
    fetcher: (async () => new Response(JSON.stringify({ status: "paid" }), { status: 200 })) as typeof fetch,
  });
  assert.equal(untouched.checked, 0);
  assert.equal(one<{ status: string }>(db, `SELECT status FROM orders WHERE id = ?`, created.order.id)!.status, "pending");

  await gatewayPay(db, created.order.order_no, SECRET, URLS.appBaseUrl, (async (_url, init) => {
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const result = handlePaymentNotify(db, payload, SECRET, 1000, now);
    return new Response("{}", { status: result.ok ? 200 : result.status });
  }) as typeof fetch, now);

  const settleAttempt = handleSettlementNotify(
    db,
    signed("settled"),
    SECRET,
    now,
  );
  assert.equal(settleAttempt.ok, true);
  assert.equal(listLedger(db, author)[0].settlement_status, "settled");
  assert.equal(one<{ status: string }>(db, `SELECT status FROM orders WHERE id = ?`, created.order.id)!.status, "paid");

  run(db, `UPDATE ledger_entries SET settlement_status = 'pending', settled_at = NULL WHERE author_id = ?`, author);
  await gatewaySettle(db, created.order.order_no, SECRET, URLS.appBaseUrl, false, fetch, now);
  const synced = await syncAuthorSettlements(db, author, {
    paymentBaseUrl: URLS.paymentBaseUrl,
    secret: SECRET,
    now,
    fetcher: (async (input) => {
      const url = new URL(String(input));
      const query = Object.fromEntries(url.searchParams);
      const result = gatewayQuery(db, query, SECRET, now);
      const body = result.body;
      body.status = "unpaid";
      body.sign = signParams(
        {
          order_no: String(body.order_no),
          status: "unpaid",
          settlement_status: String(body.settlement_status),
          amount_cents: String(body.amount_cents),
          timestamp: String(body.timestamp),
        },
        SECRET,
      );
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch,
  });
  assert.equal(synced.updated, 1);
  assert.equal(one<{ status: string }>(db, `SELECT status FROM orders WHERE id = ?`, created.order.id)!.status, "paid");
  assert.equal(incomeByWork(db, author)[0].settled_cents, 900);
  assert.equal(incomeByWork(db, author)[0].pending_cents, 0);

  run(db, `UPDATE ledger_entries SET settlement_status = 'pending', settled_at = NULL WHERE author_id = ?`, author);
  const refunded = await gatewayRefundLike(now + 10);
  assert.equal(refunded, true);
  assert.equal(one<{ status: string }>(db, `SELECT status FROM orders WHERE id = ?`, created.order.id)!.status, "refunded");
  assert.equal(listLedger(db, author)[0].settlement_status, "void");
  assert.equal(incomeByWork(db, author)[0].paid_cents, 0);
  assert.equal(incomeByWork(db, author)[0].pending_cents, 0);

  function signed(settlement: string) {
    const payload = { order_no: created.order.order_no, settlement_status: settlement, timestamp: String(now) };
    return { ...payload, timestamp: now, sign: signParams(payload, SECRET) };
  }

  async function gatewayRefundLike(timestamp: number) {
    const payload = {
      order_no: created.order.order_no,
      trade_no: "T9",
      amount_cents: "1000",
      status: "refunded",
      timestamp: String(timestamp),
    };
    const result = handlePaymentNotify(
      db,
      { ...payload, amount_cents: 1000, timestamp, sign: signParams(payload, SECRET) },
      SECRET,
      1000,
      timestamp,
    );
    return result.ok;
  }
});

test("已结算后退款不重复记账，结算结果保留", () => {
  const db = tempDb();
  const now = 1_700_000_000_000;
  const author = addUser(db, "author3@t.test", "作者", "CST10003");
  const buyer = addUser(db, "buyer3@t.test", "买家");
  const workId = novel(db, author, "已结算作品", 500);
  const created = createOrder(db, buyer, workId, URLS, now);
  const paid = notify(created.order.order_no, "paid", 500, now);
  assert.equal(paid.ok, true);
  const settled = handleSettlementNotify(db, settlement(created.order.order_no, now + 1), SECRET, now + 1);
  assert.equal(settled.ok, true);
  const refunded = notify(created.order.order_no, "refunded", 500, now + 2);
  assert.equal(refunded.ok, true);
  assert.equal(listLedger(db, author).length, 1);
  assert.equal(listLedger(db, author)[0].settlement_status, "settled");
  const again = notify(created.order.order_no, "paid", 500, now + 3);
  assert.equal(again.ok, false);
  assert.equal(listLedger(db, author).length, 1);

  function notify(orderNo: string, status: string, amount: number, timestamp: number) {
    const payload = {
      order_no: orderNo,
      trade_no: "T3",
      amount_cents: String(amount),
      status,
      timestamp: String(timestamp),
    };
    return handlePaymentNotify(db, { ...payload, amount_cents: amount, timestamp, sign: signParams(payload, SECRET) }, SECRET, 1000, timestamp);
  }
  function settlement(orderNo: string, timestamp: number) {
    const payload = { order_no: orderNo, settlement_status: "settled", timestamp: String(timestamp) };
    return { ...payload, timestamp, sign: signParams(payload, SECRET) };
  }
});
