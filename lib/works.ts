import { InputError } from "./errors";
import { many, one, run, withTransaction, type DB } from "./db";
import type { WorkType } from "./labels";

export type WorkRow = {
  id: number;
  author_id: number;
  type: WorkType;
  title: string;
  summary: string;
  cover_path: string | null;
  price_cents: number;
  preview_mode: "progress" | "content";
  preview_percent: number;
  status: "scheduled" | "published";
  publish_at: number | null;
  published_at: number | null;
  created_at: number;
  author_name?: string;
  view_count?: number;
  like_count?: number;
};

export type ChapterRow = {
  id: number;
  work_id: number;
  title: string;
  body: string | null;
  media_path: string | null;
  sort_index: number;
  is_preview: number;
};

export type ChapterInput = {
  title: string;
  body: string | null;
  mediaPath: string | null;
  isPreview: boolean;
};

export type NewWork = {
  type: WorkType;
  title: string;
  summary: string;
  coverPath: string | null;
  priceCents: number;
  previewMode: "progress" | "content";
  previewPercent: number;
  publishAt: number | null;
  chapters: ChapterInput[];
  now?: number;
};

const STATS = `
  (SELECT COUNT(*) FROM work_views v WHERE v.work_id = w.id) AS view_count,
  (SELECT COUNT(*) FROM work_likes l WHERE l.work_id = w.id) AS like_count
`;

export function touchSchedule(db: DB, now = Date.now()): void {
  run(
    db,
    `UPDATE works SET status = 'published', published_at = publish_at
     WHERE status = 'scheduled' AND publish_at IS NOT NULL AND publish_at <= ?`,
    now,
  );
}

export function createWork(db: DB, authorId: number, input: NewWork): number {
  const now = input.now ?? Date.now();
  const title = input.title.trim();
  const summary = input.summary.trim();
  if (!["novel", "comic", "video"].includes(input.type)) throw new InputError("请选择小说、漫画或视频");
  if (title.length < 1 || title.length > 80) throw new InputError("标题需要 1 到 80 个字");
  if (summary.length < 1 || summary.length > 500) throw new InputError("简介需要 1 到 500 个字");
  if (!Number.isInteger(input.priceCents) || input.priceCents < 0) throw new InputError("价格必须是非负整数分");
  if (input.previewMode !== "progress" && input.previewMode !== "content") throw new InputError("请选择预览方式");
  if (!Number.isInteger(input.previewPercent) || input.previewPercent < 0 || input.previewPercent > 100) {
    throw new InputError("预览进度需要是 0 到 100 的整数");
  }
  if (input.chapters.length < 1 || input.chapters.length > 30) throw new InputError("请添加 1 到 30 段内容");
  if (input.previewMode === "content" && !input.chapters.some((chapter) => chapter.isPreview)) {
    throw new InputError("按内容预览时，请至少勾选一段预览");
  }

  let status: "scheduled" | "published" = "published";
  let publishAt = now;
  let publishedAt: number | null = now;
  if (input.publishAt !== null) {
    if (!Number.isInteger(input.publishAt)) throw new InputError("发布时间无效");
    if (input.publishAt < now + 60_000) throw new InputError("定时发布时间需要晚于当前至少 1 分钟");
    if (input.publishAt > now + 365 * 24 * 60 * 60 * 1000) throw new InputError("定时发布时间不能超过一年");
    status = "scheduled";
    publishAt = input.publishAt;
    publishedAt = null;
  }

  const chapters = input.chapters.map((chapter, index) => {
    const chapterTitle = chapter.title.trim();
    if (chapterTitle.length < 1 || chapterTitle.length > 80) throw new InputError(`第 ${index + 1} 段标题需要 1 到 80 个字`);
    const body = chapter.body?.trim() ? chapter.body.trim() : null;
    if (body && body.length > 100_000) throw new InputError(`第 ${index + 1} 段正文过长`);
    if (input.type === "novel" && !body) throw new InputError(`第 ${index + 1} 段需要正文`);
    if (input.type !== "novel" && !chapter.mediaPath) throw new InputError(`第 ${index + 1} 段需要上传文件`);
    return {
      title: chapterTitle,
      body,
      mediaPath: chapter.mediaPath,
      isPreview: input.previewMode === "content" && chapter.isPreview ? 1 : 0,
    };
  });

  return withTransaction(db, () => {
    run(
      db,
      `INSERT INTO works (
        author_id, type, title, summary, cover_path, price_cents, preview_mode, preview_percent,
        status, publish_at, published_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      authorId,
      input.type,
      title,
      summary,
      input.coverPath,
      input.priceCents,
      input.previewMode,
      input.previewMode === "progress" ? input.previewPercent : 0,
      status,
      publishAt,
      publishedAt,
      now,
    );
    const created = one<{ id: number }>(db, `SELECT last_insert_rowid() AS id`);
    const workId = created?.id;
    if (!workId) throw new Error("作品创建失败");
    chapters.forEach((chapter, index) => {
      run(
        db,
        `INSERT INTO chapters (work_id, title, body, media_path, sort_index, is_preview) VALUES (?, ?, ?, ?, ?, ?)`,
        workId,
        chapter.title,
        chapter.body,
        chapter.mediaPath,
        index,
        chapter.isPreview,
      );
    });
    return workId;
  });
}

export function listPublished(
  db: DB,
  options: { sort: "latest" | "heat"; type: WorkType | null; now?: number },
): WorkRow[] {
  touchSchedule(db, options.now);
  const type = options.type;
  if (options.sort === "heat") {
    return many<WorkRow>(
      db,
      `SELECT w.*, u.display_name AS author_name, ${STATS}
       FROM works w JOIN users u ON u.id = w.author_id
       WHERE w.status = 'published'
         AND (SELECT COUNT(*) FROM work_views v WHERE v.work_id = w.id) > 100
         AND (? IS NULL OR w.type = ?)
       ORDER BY (
         CAST((SELECT COUNT(*) FROM work_likes l WHERE l.work_id = w.id) AS REAL) /
         (SELECT COUNT(*) FROM work_views v WHERE v.work_id = w.id)
       ) DESC,
       (SELECT COUNT(*) FROM work_likes l WHERE l.work_id = w.id) DESC,
       w.published_at DESC,
       w.id DESC`,
      type,
      type,
    );
  }
  return many<WorkRow>(
    db,
    `SELECT w.*, u.display_name AS author_name, ${STATS}
     FROM works w JOIN users u ON u.id = w.author_id
     WHERE w.status = 'published' AND (? IS NULL OR w.type = ?)
     ORDER BY w.published_at DESC, w.id DESC`,
    type,
    type,
  );
}

export function listAuthorWorks(db: DB, authorId: number, now = Date.now()): WorkRow[] {
  touchSchedule(db, now);
  return many<WorkRow>(
    db,
    `SELECT w.*, ${STATS}
     FROM works w WHERE w.author_id = ?
     ORDER BY w.created_at DESC`,
    authorId,
  );
}

export function getWork(db: DB, id: number, now = Date.now()): WorkRow | null {
  touchSchedule(db, now);
  const work = one<WorkRow>(
    db,
    `SELECT w.*, u.display_name AS author_name, ${STATS}
     FROM works w JOIN users u ON u.id = w.author_id
     WHERE w.id = ?`,
    id,
  );
  return work ?? null;
}

export function getChapters(db: DB, workId: number): ChapterRow[] {
  return many<ChapterRow>(db, `SELECT * FROM chapters WHERE work_id = ? ORDER BY sort_index ASC, id ASC`, workId);
}

export function recordView(db: DB, userId: number | null, workId: number, now = Date.now()): {
  counted: boolean;
  viewCount: number;
} {
  const work = one<{ status: string }>(db, `SELECT status FROM works WHERE id = ?`, workId);
  if (!work || work.status !== "published" || !userId) {
    return { counted: false, viewCount: viewCountOf(db, workId) };
  }
  const changes = run(
    db,
    `INSERT INTO work_views (user_id, work_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
    userId,
    workId,
    now,
  );
  return { counted: changes === 1, viewCount: viewCountOf(db, workId) };
}

export function toggleLike(db: DB, userId: number, workId: number, now = Date.now()): {
  liked: boolean;
  likeCount: number;
} {
  const work = one<{ status: string }>(db, `SELECT status FROM works WHERE id = ?`, workId);
  if (!work || work.status !== "published") throw new InputError("作品还不能点赞", 404);
  const existing = one(db, `SELECT 1 AS ok FROM work_likes WHERE user_id = ? AND work_id = ?`, userId, workId);
  if (existing) {
    run(db, `DELETE FROM work_likes WHERE user_id = ? AND work_id = ?`, userId, workId);
  } else {
    run(db, `INSERT INTO work_likes (user_id, work_id, created_at) VALUES (?, ?, ?)`, userId, workId, now);
  }
  const liked = !existing;
  return { liked, likeCount: likeCountOf(db, workId) };
}

export function viewCountOf(db: DB, workId: number): number {
  return one<{ c: number }>(db, `SELECT COUNT(*) AS c FROM work_views WHERE work_id = ?`, workId)?.c ?? 0;
}

export function likeCountOf(db: DB, workId: number): number {
  return one<{ c: number }>(db, `SELECT COUNT(*) AS c FROM work_likes WHERE work_id = ?`, workId)?.c ?? 0;
}

export function hasLiked(db: DB, userId: number | null, workId: number): boolean {
  if (!userId) return false;
  return Boolean(one(db, `SELECT 1 AS ok FROM work_likes WHERE user_id = ? AND work_id = ?`, userId, workId));
}
