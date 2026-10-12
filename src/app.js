import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { HttpError, asyncRoute, safeNext, wantsJson } from './errors.js';
import {
  attachUser, consumeCode, cookieOptions, createSession, destroySession,
  issueCode, loginUser, publicUser, registerUser,
} from './authlib.js';
import { deliverCode } from './mailer.js';
import {
  accessOf, createWork, getWork, listAuthorWorks, listWorks, presentWork,
  publishDue, recordView, resolveAsset, safeUploadPath, toggleLike, visibleTo, workAssets,
} from './catalog.js';
import {
  applyGatewayNotify, applySettlement, canSeeOrder, createOrder, incomeEntries,
  incomeSummary, listBuyerOrders, readOrder, syncSettlement, walletUrl,
} from './trade.js';
import { esc, feeText, qinglanPage } from './ui.js';
import {
  renderAuth, renderBrowse, renderHome, renderIncome, renderMailbox, renderNotFound,
  renderOrders, renderPublish, renderResult, renderStudio, renderWork,
} from './pages.js';
import { mountQinglan } from './qinglan.js';

function pipeFile(req, res, file, mime) {
  const stat = fs.statSync(file);
  res.setHeader('Content-Type', mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Accept-Ranges', 'bytes');
  const range = req.headers.range;
  if (!range) {
    res.setHeader('Content-Length', String(stat.size));
    fs.createReadStream(file).pipe(res);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (match[1] === '' && match[2] === '')) {
    res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
    return;
  }
  const suffix = match[1] === '';
  let start = suffix ? Math.max(0, stat.size - Number(match[2])) : Number(match[1]);
  let end = suffix ? stat.size - 1 : (match[2] === '' ? stat.size - 1 : Number(match[2]));
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
    res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
    return;
  }
  end = Math.min(end, stat.size - 1);
  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
  res.setHeader('Content-Length', String(end - start + 1));
  fs.createReadStream(file, { start, end }).pipe(res);
}

function makeUpload(config) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, config.uploadDir),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8);
        cb(null, `${Date.now()}-${randomBytes(6).toString('hex')}${ext}`);
      },
    }),
    limits: { fileSize: 80 * 1024 * 1024, files: 32, fieldSize: 2 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm))$/.test(file.mimetype || '');
      if (!ok) cb(new Error('只支持 JPG、PNG、WEBP、GIF 图片，以及 MP4、WEBM 视频'));
      else cb(null, true);
    },
  });
}

export function createApp({ db, config }) {
  if (!Number.isInteger(config.platformFeeBps) || config.platformFeeBps < 0 || config.platformFeeBps > 10000) {
    throw new Error('平台分成须为 0 到 10000 的整数');
  }
  const app = express();
  const upload = makeUpload(config);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());
  app.use(attachUser(db));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.static(config.publicDir, { index: false, maxAge: 0 }));

  function signIn(res, user) {
    res.cookie('ncstar_sid', createSession(db, config, user.id), cookieOptions(config));
  }

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, name: 'NCstar' });
  });

  app.post('/api/auth/send-code', asyncRoute(async (req, res) => {
    const issued = issueCode(db, config, { email: req.body?.email, purpose: req.body?.purpose });
    await deliverCode({ config, email: issued.email, purpose: issued.purpose, code: issued.code });
    if (wantsJson(req)) return res.json({ ok: true, dev: Boolean(config.devMailbox) });
    const back = safeNext(req.body?.returnTo, issued.purpose === 'register' ? '/register' : '/login');
    const url = new URL(back, config.publicBaseUrl);
    url.searchParams.set('sent', '1');
    url.searchParams.set('email', issued.email);
    const next = safeNext(req.body?.next, '');
    if (req.body?.next && next) url.searchParams.set('next', next);
    return res.redirect(`${url.pathname}${url.search}`);
  }));

  app.post('/api/auth/register', (req, res, next) => {
    try {
      const email = consumeCode(db, { email: req.body?.email, purpose: 'register', code: req.body?.code });
      const row = registerUser(db, { email, password: req.body?.password, nickname: req.body?.nickname });
      signIn(res, row);
      if (wantsJson(req)) return res.status(201).json({ user: publicUser(row) });
      return res.redirect(safeNext(req.body?.next, '/me'));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/login', (req, res, next) => {
    try {
      const email = consumeCode(db, { email: req.body?.email, purpose: 'login', code: req.body?.code });
      const row = loginUser(db, { email, password: req.body?.password });
      signIn(res, row);
      if (wantsJson(req)) return res.json({ user: publicUser(row) });
      return res.redirect(safeNext(req.body?.next, '/'));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    destroySession(db, req.sessionId);
    res.clearCookie('ncstar_sid', cookieOptions(config));
    if (wantsJson(req)) return res.json({ ok: true });
    return res.redirect('/');
  });

  app.get('/api/auth/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: '请先登录' });
    return res.json({ user: req.user });
  });

  app.get('/api/works', (req, res, next) => {
    try {
      const works = listWorks(db, {
        type: req.query.type,
        sort: req.query.sort || 'latest',
        q: req.query.q || '',
        limit: req.query.limit,
        offset: req.query.offset,
      });
      res.json({
        works: works.map((work) => ({
          id: work.id,
          type: work.type,
          title: work.title,
          priceCents: work.price_cents,
          viewCount: work.view_count,
          likeCount: work.like_count,
          heat: work.heat,
          heatEligible: work.heatEligible,
          author: work.author_nickname,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/works/:id', (req, res, next) => {
    const work = getWork(db, Number(req.params.id));
    if (!/^\d+$/.test(req.params.id) || !visibleTo(work, req.user)) return next();
    return res.json({ work: presentWork(db, work, req.user) });
  });

  app.post('/api/works', upload.fields([
    { name: 'cover', maxCount: 1 },
    { name: 'pages', maxCount: 30 },
    { name: 'video', maxCount: 1 },
  ]), (req, res, next) => {
    try {
      if (!req.user) {
        for (const group of Object.values(req.files || {})) {
          for (const file of group || []) fs.unlink(file.path, () => {});
        }
        throw new HttpError(401, '请先登录');
      }
      const created = createWork(db, req.user.id, req.body, req.files);
      if (wantsJson(req)) return res.status(201).json(created);
      return res.redirect(`/works/${created.id}`);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/works/:id/view', (req, res) => {
    if (!req.user) return res.status(401).json({ error: '请先登录' });
    if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: '作品不存在' });
    const result = recordView(db, req.user.id, Number(req.params.id));
    if (!result) return res.status(404).json({ error: '作品不存在' });
    return res.json(result);
  });

  app.post('/api/works/:id/like', (req, res, next) => {
    try {
      if (!req.user) throw new HttpError(401, '请先登录');
      if (!/^\d+$/.test(req.params.id)) throw new HttpError(404, '作品不存在');
      const result = toggleLike(db, req.user.id, Number(req.params.id));
      if (wantsJson(req)) return res.json(result);
      return res.redirect(safeNext(req.body?.next, `/works/${req.params.id}`));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/orders', (req, res, next) => {
    try {
      if (!req.user) throw new HttpError(401, '请先登录');
      const created = createOrder(db, config, req.user, req.body?.workId);
      if (wantsJson(req)) return res.status(201).json(created);
      return res.redirect(created.payUrl);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/orders/:orderNo/pay', (req, res, next) => {
    try {
      if (!req.user) throw new HttpError(401, '请先登录');
      const order = readOrder(db, req.params.orderNo);
      if (!order || order.buyer_id !== req.user.id) throw new HttpError(404, '订单不存在');
      if (order.status !== 'pending') throw new HttpError(409, '这笔订单不需要继续支付');
      const work = getWork(db, order.work_id);
      const created = createOrder(db, config, req.user, work.id);
      if (wantsJson(req)) return res.json(created);
      return res.redirect(created.payUrl);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/orders', (req, res) => {
    if (!req.user) return res.status(401).json({ error: '请先登录' });
    return res.json({ orders: listBuyerOrders(db, req.user.id) });
  });

  app.get('/api/orders/:orderNo', (req, res) => {
    if (!req.user) return res.status(401).json({ error: '请先登录' });
    const order = readOrder(db, req.params.orderNo);
    if (!canSeeOrder(order, req.user)) return res.status(404).json({ error: '订单不存在' });
    return res.json({
      order: {
        orderNo: order.order_no,
        buyerId: order.buyer_id,
        authorId: order.author_id,
        workId: order.work_id,
        amountCents: order.amount_cents,
        status: order.status,
      },
    });
  });

  app.post('/api/payments/qinglan/notify', (req, res) => {
    const result = applyGatewayNotify(db, config, req.body || {});
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json({ ok: true, duplicate: Boolean(result.duplicate) });
  });

  app.post('/api/payments/qinglan/settlement', (req, res) => {
    const result = applySettlement(db, config, req.body || {});
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.json({ ok: true, duplicate: Boolean(result.duplicate) });
  });

  app.get('/api/income', (req, res) => {
    if (!req.user) return res.status(401).json({ error: '请先登录' });
    return res.json({
      customerId: req.user.qinglanCustomerId,
      summary: incomeSummary(db, req.user.id),
      entries: incomeEntries(db, req.user.id),
    });
  });

  app.post('/api/income/sync-settlement', asyncRoute(async (req, res) => {
    if (!req.user) throw new HttpError(401, '请先登录');
    const result = await syncSettlement(db, config, req.user.id, req.body?.orderNo || '');
    if (wantsJson(req)) return res.json(result);
    return res.redirect('/me/income?synced=1');
  }));

  app.get('/media/works/:id/cover', (req, res, next) => {
    const work = getWork(db, Number(req.params.id));
    if (!/^\d+$/.test(req.params.id) || !visibleTo(work, req.user) || !work.cover_path) return next();
    const file = safeUploadPath(config.uploadDir, work.cover_path);
    if (!file || !fs.existsSync(file)) return next();
    const coverMime = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    }[path.extname(work.cover_path).toLowerCase()] || 'application/octet-stream';
    return pipeFile(req, res, file, coverMime);
  });

  app.get('/media/works/:id/pages/:assetId', (req, res, next) => {
    const work = getWork(db, Number(req.params.id));
    if (!/^\d+$/.test(req.params.id) || !/^\d+$/.test(req.params.assetId) || !visibleTo(work, req.user)) return next();
    const assets = workAssets(db, work.id);
    const asset = assets.find((item) => item.id === Number(req.params.assetId) && item.kind === 'page');
    const pages = assets.filter((item) => item.kind === 'page');
    const access = accessOf(db, work, req.user);
    const allowed = access === 'full'
      ? pages.length
      : (work.preview_mode === 'progress' ? Math.floor((pages.length * (work.preview_percent || 0)) / 100) : 0);
    const index = pages.findIndex((item) => item.id === asset?.id);
    if (!asset || index < 0 || index >= allowed) return res.status(403).type('text/plain').send('没有阅读权限');
    const file = resolveAsset(config.uploadDir, asset);
    if (!file) return next();
    return pipeFile(req, res, file, asset.mime);
  });

  app.get('/media/works/:id/video', (req, res, next) => {
    const work = getWork(db, Number(req.params.id));
    if (!/^\d+$/.test(req.params.id) || !visibleTo(work, req.user)) return next();
    const asset = workAssets(db, work.id).find((item) => item.kind === 'video');
    if (!asset) return next();
    const access = accessOf(db, work, req.user);
    if (access !== 'full' && work.preview_mode !== 'progress') {
      return res.status(403).type('text/plain').send('没有播放权限');
    }
    const file = resolveAsset(config.uploadDir, asset);
    if (!file) return next();
    return pipeFile(req, res, file, asset.mime);
  });

  mountQinglan(app, { db, config });

  app.get('/', (req, res) => {
    res.type('html').send(renderHome({
      user: req.user,
      heat: listWorks(db, { sort: 'heat', limit: 6 }),
      latest: listWorks(db, { sort: 'latest', limit: 6 }),
    }));
  });

  app.get('/browse', (req, res, next) => {
    try {
      const sort = String(req.query.sort || 'latest');
      const type = String(req.query.type || '');
      const q = String(req.query.q || '').slice(0, 40);
      const works = listWorks(db, { sort, type, q, limit: 48 });
      res.type('html').send(renderBrowse({ user: req.user, works, sort, type, q }));
    } catch (err) {
      next(err);
    }
  });

  app.get('/works/:id', (req, res, next) => {
    if (!/^\d+$/.test(req.params.id)) return next();
    const work = getWork(db, Number(req.params.id));
    if (!visibleTo(work, req.user)) return next();
    if (req.user && work.status === 'published') recordView(db, req.user.id, work.id);
    const fresh = getWork(db, work.id);
    res.type('html').send(renderWork({ user: req.user, work: presentWork(db, fresh, req.user) }));
  });

  app.get('/login', (req, res) => {
    res.type('html').send(renderAuth({ user: req.user, config, mode: 'login', query: req.query }));
  });

  app.get('/register', (req, res) => {
    res.type('html').send(renderAuth({ user: req.user, config, mode: 'register', query: req.query }));
  });

  app.get('/publish', (req, res) => {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent('/publish')}`);
    return res.type('html').send(renderPublish({ user: req.user, error: req.query.error }));
  });

  app.get('/me', (req, res) => {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent('/me')}`);
    return res.type('html').send(renderStudio({ user: req.user, works: listAuthorWorks(db, req.user.id) }));
  });

  app.get('/me/orders', (req, res) => {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent('/me/orders')}`);
    return res.type('html').send(renderOrders({ user: req.user, orders: listBuyerOrders(db, req.user.id) }));
  });

  app.get('/me/income', (req, res) => {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent('/me/income')}`);
    return res.type('html').send(renderIncome({
      user: req.user,
      summary: incomeSummary(db, req.user.id),
      entries: incomeEntries(db, req.user.id),
      wallet: walletUrl(config, req.user.qinglanCustomerId),
      feeLabel: feeText(config.platformFeeBps),
      error: req.query.error,
      synced: req.query.synced,
    }));
  });

  app.get('/orders/:orderNo/result', (req, res) => {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(`/orders/${req.params.orderNo}/result`)}`);
    const order = readOrder(db, req.params.orderNo);
    if (!canSeeOrder(order, req.user)) return res.status(404).type('html').send(renderNotFound({ user: req.user }));
    return res.type('html').send(renderResult({
      user: req.user,
      order: {
        orderNo: order.order_no,
        workId: order.work_id,
        workTitle: order.title,
        buyerNickname: order.buyer_nickname,
        authorNickname: order.author_nickname,
        amountCents: order.amount_cents,
        status: order.status,
      },
      sync: req.query.sync,
    }));
  });

  app.get('/dev/mailbox', (req, res, next) => {
    if (!config.devMailbox) return next();
    const rows = db.prepare('SELECT * FROM mailbox ORDER BY id DESC LIMIT 30').all();
    return res.type('html').send(renderMailbox({ user: req.user, rows }));
  });

  app.use((req, res) => {
    if (wantsJson(req) || req.path.startsWith('/api/')) return res.status(404).json({ error: '没有找到' });
    return res.status(404).type('html').send(renderNotFound({ user: req.user }));
  });

  app.use((err, req, res, _next) => {
    if (res.headersSent) return;
    const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 400 : err.type === 'entity.parse.failed' ? 400 : 500);
    let message = status >= 500 ? '暂时无法完成' : err.message;
    if (err.code === 'LIMIT_FILE_SIZE') message = '文件过大，请小于 80MB';
    if (err.type === 'entity.parse.failed') message = '请求格式无效';
    if (status >= 500) console.error(err);
    if (req.path.startsWith('/qinglan') && !wantsJson(req)) {
      return res.status(status).type('html').send(qinglanPage({
        title: '青澜',
        body: `<section class="pay-card"><h1>没有完成</h1><p>${esc(message)}</p></section>`,
      }));
    }
    if (!wantsJson(req) && req.method === 'POST') {
      let back = '/';
      if (req.path.startsWith('/api/auth')) back = safeNext(req.body?.returnTo, '/login');
      else if (req.path === '/api/works') back = '/publish';
      else if (req.body?.next) back = safeNext(req.body.next, '/');
      const url = new URL(back, config.publicBaseUrl);
      url.searchParams.set('error', message);
      if (req.body?.email) url.searchParams.set('email', String(req.body.email).slice(0, 120));
      if (req.body?.next) url.searchParams.set('next', safeNext(req.body.next, '/'));
      return res.redirect(`${url.pathname}${url.search}`);
    }
    return res.status(status).json({ error: message });
  });

  if (config.scheduler) {
    publishDue(db, Date.now());
    const timer = setInterval(() => {
      try {
        publishDue(db, Date.now());
      } catch (err) {
        console.error(err);
      }
    }, 5000);
    timer.unref();
  }

  return app;
}
