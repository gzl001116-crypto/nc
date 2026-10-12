import { InputError } from "./errors";
import { yuanToCents } from "./money";
import { saveMedia } from "./media";
import { createWork, type ChapterInput } from "./works";
import type { DB } from "./db";
import type { WorkType } from "./labels";

export async function createWorkFromForm(db: DB, authorId: number, form: FormData, now = Date.now()): Promise<number> {
  const type = String(form.get("type") || "") as WorkType;
  const title = String(form.get("title") || "");
  const summary = String(form.get("summary") || "");
  const priceCents = yuanToCents(String(form.get("priceYuan") || ""));
  if (priceCents === null) throw new InputError("价格格式不正确，最多两位小数");
  const previewMode = String(form.get("previewMode") || "");
  if (previewMode !== "progress" && previewMode !== "content") throw new InputError("请选择预览方式");
  const previewPercent = Number(form.get("previewPercent") || "0");
  const publishMode = String(form.get("publishMode") || "now");
  let publishAt: number | null = null;
  if (publishMode === "schedule") {
    publishAt = parseLocalDateTime(String(form.get("publishAt") || ""));
    if (publishAt === null) throw new InputError("请填写定时发布时间");
  } else if (publishMode !== "now") {
    throw new InputError("请选择发布时间");
  }

  let coverPath: string | null = null;
  const cover = form.get("cover");
  if (cover instanceof File && cover.size > 0) coverPath = await saveMedia(cover, "image");

  let parsed: unknown;
  try {
    parsed = JSON.parse(String(form.get("chapters") || ""));
  } catch {
    throw new InputError("章节数据无效");
  }
  if (!Array.isArray(parsed)) throw new InputError("章节数据无效");
  const chapters: ChapterInput[] = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const item = parsed[index];
    if (!item || typeof item !== "object") throw new InputError("章节数据无效");
    const record = item as { title?: unknown; body?: unknown; isPreview?: unknown };
    const file = form.get(`chapterFile_${index}`);
    let mediaPath: string | null = null;
    if (file instanceof File && file.size > 0) {
      mediaPath = await saveMedia(file, type === "video" ? "video" : "image");
    }
    chapters.push({
      title: String(record.title || ""),
      body: record.body == null ? null : String(record.body),
      mediaPath,
      isPreview: Boolean(record.isPreview),
    });
  }

  return createWork(db, authorId, {
    type,
    title,
    summary,
    coverPath,
    priceCents,
    previewMode,
    previewPercent,
    publishAt,
    chapters,
    now,
  });
}

function parseLocalDateTime(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    0,
    0,
  );
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1) return null;
  return date.getTime();
}
