import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './errors.js';
import { immediate } from './db.js';
import { parseCents, yuanTextToCents } from './money.js';

const TYPES = new Set(['novel', 'comic', 'video']);
const IMAGE_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};
const VIDEO_EXT = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

function chars(value) {
  return Array.from(String(value ?? ''));
}

function clean(value) {
  return String(value ?? '').replace(/\u0000/g, '').trim();
}

function requireText(value, { min, max, label }) {
  const text = clean(value);
  const len = chars(text).length;
  if (len < min || len > max) {
    throw new HttpError(400, min === 0 ? `${label}最多 ${max} 个字` : `${label}需要 ${min} 到 ${max} 个字`);
  }
  return text;
}

export function publishDue(db, now = Date.now()) {
  const info = db.prepare(`
    UPDATE works
    SET status = 'published', published_at = publish_at, updated_at = ?
    WHERE status = 'scheduled' AND publish_at IS NOT NULL AND publish_at <= ?
  `).run(now, now);
  return info.changes;
}

export function listWorks(db, { type, sort = 'latest', q, limit = 24, offset = 0 } = {}) {
  const where = [`works.status = 'published'`];
  const params = [];
  if (type && TYPES.has(type)) {
    where.push('works.type = ?');
    params.push(type);
  }
  if (q) {
    where.push(`works.title LIKE ? ESCAPE '\\'`);
    params.push(`%${String(q).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
  }
  let order = 'works.published_at DESC, works.id DESC';
  if (sort === 'heat') {
    where.push('works.view_count > 100');
    order = '(works.like_count * 1.0 / works.view_count) DESC, works.like_count DESC, works.view_count DESC, works.id DESC';
  } else if (sort === 'price') {
    order = 'works.price_cents ASC, works.published_at DESC, works.id DESC';
  } else if (sort !== 'latest') {
    throw new HttpError(400, '不支持的排序');
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 24, 1), 60);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  return db.prepare(`
    SELECT works.*, users.nickname AS author_nickname
    FROM works JOIN users ON users.id = works.author_id
    WHERE ${where.join(' AND ')}
    ORDER BY ${order}
    LIMIT ? OFFSET ?
  `).all(...params, safeLimit, safeOffset).map(decorate);
}

export function decorate(row) {
  if (!row) return null;
  const viewCount = row.view_count;
  const likeCount = row.like_count;
  const heatEligible = viewCount > 100;
  return {
    ...row,
    heatEligible,
    heat: heatEligible && viewCount > 0 ? likeCount / viewCount : null,
  };
}

export function getWork(db, id) {
  const row = db.prepare(`
    SELECT works.*, users.nickname AS author_nickname, users.qinglan_customer_id AS author_customer_id
    FROM works JOIN users ON users.id = works.author_id
    WHERE works.id = ?
  `).get(id);
  return row ? decorate(row) : null;
}

export function visibleTo(work, user) {
  if (!work) return false;
  if (work.status === 'published') return true;
  return Boolean(user && user.id === work.author_id);
}

export function workAssets(db, workId) {
  return db.prepare('SELECT * FROM work_assets WHERE work_id = ? ORDER BY sort_order ASC, id ASC').all(workId);
}

export function hasPaid(db, userId, workId) {
  if (!userId) return false;
  return Boolean(db.prepare(`
    SELECT 1 FROM orders WHERE buyer_id = ? AND work_id = ? AND status = 'paid' LIMIT 1
  `).get(userId, workId));
}

export function accessOf(db, work, user) {
  if (user && user.id === work.author_id) return 'full';
  if (work.price_cents === 0) return 'full';
  if (hasPaid(db, user?.id, work.id)) return 'full';
  return 'preview';
}

export function sliceByPercent(text, percent) {
  const all = chars(text);
  const shown = Math.floor((all.length * percent) / 100);
  return {
    text: all.slice(0, shown).join(''),
    totalChars: all.length,
    shownChars: shown,
  };
}

export function presentWork(db, work, user) {
  const assets = workAssets(db, work.id);
  const pages = assets.filter((asset) => asset.kind === 'page');
  const video = assets.find((asset) => asset.kind === 'video') || null;
  const access = accessOf(db, work, user);
  const full = access === 'full';
  const progress = work.preview_mode === 'progress';
  const percent = work.preview_percent || 0;
  const sliced = sliceByPercent(work.body || '', progress ? percent : 0);
  const shownPages = full || !progress ? (full ? pages.length : 0) : Math.floor((pages.length * percent) / 100);
  const visiblePages = (full ? pages : pages.slice(0, shownPages)).map((page) => ({
    id: page.id,
    url: `/media/works/${work.id}/pages/${page.id}`,
  }));
  const showVideo = Boolean(video) && (full || progress);
  const liked = user
    ? Boolean(db.prepare('SELECT 1 FROM work_likes WHERE user_id = ? AND work_id = ?').get(user.id, work.id))
    : false;
  const purchased = Boolean(user && user.id !== work.author_id && work.price_cents > 0 && hasPaid(db, user.id, work.id));
  const pending = user
    ? db.prepare(`
        SELECT order_no FROM orders
        WHERE buyer_id = ? AND work_id = ? AND status = 'pending'
        ORDER BY id DESC LIMIT 1
      `).get(user.id, work.id)
    : null;
  return {
    id: work.id,
    type: work.type,
    title: work.title,
    summary: work.summary,
    priceCents: work.price_cents,
    previewMode: work.preview_mode,
    previewPercent: work.preview_percent,
    previewText: work.preview_text,
    viewCount: work.view_count,
    likeCount: work.like_count,
    heat: work.heat,
    heatEligible: work.heatEligible,
    author: { id: work.author_id, nickname: work.author_nickname },
    coverUrl: work.cover_path ? `/media/works/${work.id}/cover` : null,
    access,
    liked,
    purchased,
    pendingOrderNo: pending?.order_no || null,
    status: work.status,
    publishAt: work.publish_at,
    publishedAt: work.published_at,
    body: full ? (work.body || '') : (progress ? sliced.text : ''),
    bodyTruncated: !full && progress && sliced.shownChars < sliced.totalChars,
    shownChars: full ? chars(work.body || '').length : (progress ? sliced.shownChars : 0),
    totalChars: chars(work.body || '').length,
    pages: visiblePages,
    pageCount: pages.length,
    shownPageCount: full ? pages.length : shownPages,
    videoUrl: showVideo ? `/media/works/${work.id}/video` : null,
    mine: Boolean(user && user.id === work.author_id),
  };
}

export function recordView(db, userId, workId) {
  if (!userId) return null;
  const work = db.prepare('SELECT id, status FROM works WHERE id = ?').get(workId);
  if (!work || work.status !== 'published') return null;
  return immediate(db, () => {
    const info = db.prepare(`
      INSERT INTO work_views (user_id, work_id, created_at) VALUES (?, ?, ?)
      ON CONFLICT DO NOTHING
    `).run(userId, workId, Date.now());
    if (info.changes === 1) {
      db.prepare('UPDATE works SET view_count = view_count + 1 WHERE id = ?').run(workId);
    }
    const viewCount = db.prepare('SELECT view_count FROM works WHERE id = ?').get(workId).view_count;
    return { counted: info.changes === 1, viewCount };
  });
}

export function toggleLike(db, userId, workId) {
  const work = db.prepare('SELECT id, status FROM works WHERE id = ?').get(workId);
  if (!work || work.status !== 'published') throw new HttpError(404, '作品不存在');
  return immediate(db, () => {
    const existing = db.prepare('SELECT 1 FROM work_likes WHERE user_id = ? AND work_id = ?').get(userId, workId);
    if (existing) {
      db.prepare('DELETE FROM work_likes WHERE user_id = ? AND work_id = ?').run(userId, workId);
      db.prepare('UPDATE works SET like_count = like_count - 1 WHERE id = ? AND like_count > 0').run(workId);
    } else {
      db.prepare('INSERT INTO work_likes (user_id, work_id, created_at) VALUES (?, ?, ?)').run(userId, workId, Date.now());
      db.prepare('UPDATE works SET like_count = like_count + 1 WHERE id = ?').run(workId);
    }
    const likeCount = db.prepare('SELECT like_count FROM works WHERE id = ?').get(workId).like_count;
    return { liked: !existing, likeCount };
  });
}

function unlinkFiles(files) {
  for (const group of Object.values(files || {})) {
    for (const file of group || []) {
      if (file?.path) fs.unlink(file.path, () => {});
    }
  }
}

function fileKind(file, table) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mime = table[ext];
  if (!mime || file.mimetype !== mime) return null;
  if (!/^[\w.-]+$/.test(file.filename || '')) return null;
  return { ext, mime, filename: file.filename };
}

export function createWork(db, authorId, input, files = {}) {
  try {
    const type = String(input.type || '');
    if (!TYPES.has(type)) throw new HttpError(400, '请选择小说、漫画或视频');
    const title = requireText(input.title, { min: 1, max: 40, label: '标题' });
    const summary = requireText(input.summary, { min: 0, max: 240, label: '简介' });
    let priceCents = parseCents(input.priceCents);
    if (priceCents === null && input.priceYuan !== undefined && input.priceYuan !== '') {
      try {
        priceCents = yuanTextToCents(input.priceYuan);
      } catch (err) {
        throw new HttpError(400, err.message);
      }
    }
    if (priceCents === null || priceCents > 100_000_000) throw new HttpError(400, '价格须为整数分');
    const previewMode = String(input.previewMode || '');
    if (previewMode !== 'progress' && previewMode !== 'content') throw new HttpError(400, '请选择预览进度或预览内容');
    let previewPercent = null;
    let previewText = clean(input.previewText);
    if (previewMode === 'progress') {
      previewPercent = parseCents(input.previewPercent);
      if (previewPercent === null || previewPercent < 1 || previewPercent > 99) {
        throw new HttpError(400, '预览进度须为 1 到 99 的整数');
      }
      if (chars(previewText).length > 2000) throw new HttpError(400, '预览说明过长');
    } else {
      previewText = requireText(input.previewText, { min: 1, max: 2000, label: '预览内容' });
    }
    const bodyLimit = type === 'novel' ? 200000 : 8000;
    const bodyMin = type === 'novel' ? 20 : 0;
    const body = requireText(input.body, { min: bodyMin, max: bodyLimit, label: type === 'novel' ? '正文' : '补充说明' });
    const cover = (files.cover || [])[0];
    const pages = files.pages || [];
    const video = (files.video || [])[0];
    if (type === 'novel' && (pages.length || video)) throw new HttpError(400, '小说不需要上传页或视频');
    if (type === 'comic' && video) throw new HttpError(400, '漫画不需要上传视频');
    if (type === 'video' && pages.length) throw new HttpError(400, '视频不需要上传漫画页');
    if (type === 'comic' && pages.length < 1) throw new HttpError(400, '漫画至少上传一页');
    if (type === 'comic' && pages.length > 30) throw new HttpError(400, '漫画最多 30 页');
    if (type === 'video' && !video) throw new HttpError(400, '请上传视频文件');
    let coverName = null;
    if (cover) {
      const kind = fileKind(cover, IMAGE_EXT);
      if (!kind) throw new HttpError(400, '封面只支持 JPG、PNG、WEBP、GIF');
      coverName = kind.filename;
    }
    const pageRows = [];
    if (type === 'comic') {
      pages.forEach((page, index) => {
        const kind = fileKind(page, IMAGE_EXT);
        if (!kind) throw new HttpError(400, '漫画页只支持 JPG、PNG、WEBP、GIF');
        pageRows.push({ filename: kind.filename, mime: kind.mime, sort: index });
      });
    }
    let videoRow = null;
    if (type === 'video') {
      const kind = fileKind(video, VIDEO_EXT);
      if (!kind) throw new HttpError(400, '视频只支持 MP4 或 WEBM');
      videoRow = { filename: kind.filename, mime: kind.mime };
    }
    const publishMode = String(input.publishMode || 'now');
    const now = Date.now();
    let status = 'published';
    let publishAt = now;
    let publishedAt = now;
    if (publishMode === 'schedule') {
      const rawAt = input.publishAt !== undefined && input.publishAt !== ''
        ? input.publishAt
        : Date.parse(input.publishAtLocal || '');
      const at = Number(rawAt);
      if (!Number.isFinite(at)) throw new HttpError(400, '请选择定时投稿的时间');
      if (at <= now + 1000) throw new HttpError(400, '定时投稿需要晚于当前时间');
      if (at > now + 180 * 86400000) throw new HttpError(400, '定时投稿需要在 180 天以内');
      status = 'scheduled';
      publishAt = at;
      publishedAt = null;
    } else if (publishMode !== 'now') {
      throw new HttpError(400, '请选择立即发布或定时投稿');
    }
    const id = immediate(db, () => {
      const info = db.prepare(`
        INSERT INTO works (
          author_id, type, title, summary, cover_path, body, price_cents, preview_mode,
          preview_percent, preview_text, publish_at, status, published_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        authorId, type, title, summary, coverName, body, priceCents, previewMode,
        previewPercent, previewText, publishAt, status, publishedAt, now, now,
      );
      const workId = Number(info.lastInsertRowid);
      const insertAsset = db.prepare(`
        INSERT INTO work_assets (work_id, kind, path, mime, sort_order) VALUES (?, ?, ?, ?, ?)
      `);
      for (const page of pageRows) insertAsset.run(workId, 'page', page.filename, page.mime, page.sort);
      if (videoRow) insertAsset.run(workId, 'video', videoRow.filename, videoRow.mime, 0);
      return workId;
    });
    return { id, status };
  } catch (err) {
    unlinkFiles(files);
    throw err;
  }
}

export function safeUploadPath(uploadDir, name) {
  if (!name || !/^[\w.-]+$/.test(name)) return null;
  const root = path.resolve(uploadDir);
  const full = path.resolve(root, name);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

const SERVE_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'video/mp4', 'video/webm',
]);

export function resolveAsset(uploadDir, asset) {
  if (!asset || !SERVE_MIME.has(asset.mime)) return null;
  const full = safeUploadPath(uploadDir, asset.path);
  if (!full || !fs.existsSync(full)) return null;
  return full;
}

export function listAuthorWorks(db, authorId) {
  return db.prepare(`
    SELECT * FROM works WHERE author_id = ? ORDER BY created_at DESC, id DESC
  `).all(authorId).map(decorate);
}
