export type StoredChapter = {
  id: number;
  title: string;
  body: string | null;
  media_path: string | null;
  sort_index: number;
  is_preview: number;
};

export type ShownChapter = {
  id: number;
  title: string;
  level: "full" | "partial" | "locked";
  text: string | null;
  mediaUrl: string | null;
  partialRatio: number | null;
};

export function previewText(text: string, ratio: number): string {
  const chars = Array.from(text);
  if (chars.length === 0 || ratio <= 0) return "";
  const count = Math.max(1, Math.floor(chars.length * ratio));
  return chars.slice(0, Math.min(chars.length, count)).join("");
}

export function showChapters(
  chapters: StoredChapter[],
  options: {
    type: "novel" | "comic" | "video";
    previewMode: "progress" | "content";
    previewPercent: number;
    unlocked: boolean;
  },
): ShownChapter[] {
  const percent = Math.min(100, Math.max(0, options.previewPercent));
  const fullCount =
    options.previewMode === "progress" ? Math.floor((chapters.length * percent) / 100) : 0;
  const ratio = percent / 100;

  return chapters.map((chapter, index) => {
    const mediaUrl = chapter.media_path ? `/media/${chapter.media_path}` : null;
    if (options.unlocked) {
      return {
        id: chapter.id,
        title: chapter.title,
        level: "full",
        text: chapter.body,
        mediaUrl,
        partialRatio: null,
      };
    }

    if (options.previewMode === "content") {
      if (chapter.is_preview === 1) {
        return {
          id: chapter.id,
          title: chapter.title,
          level: "full",
          text: chapter.body,
          mediaUrl,
          partialRatio: null,
        };
      }
      return locked(chapter);
    }

    if (index < fullCount) {
      return {
        id: chapter.id,
        title: chapter.title,
        level: "full",
        text: chapter.body,
        mediaUrl,
        partialRatio: null,
      };
    }

    if (fullCount === 0 && percent > 0 && index === 0) {
      if (options.type === "novel") {
        return {
          id: chapter.id,
          title: chapter.title,
          level: "partial",
          text: previewText(chapter.body || "", ratio),
          mediaUrl: null,
          partialRatio: ratio,
        };
      }
      return {
        id: chapter.id,
        title: chapter.title,
        level: "partial",
        text: null,
        mediaUrl,
        partialRatio: ratio,
      };
    }

    return locked(chapter);
  });
}

function locked(chapter: StoredChapter): ShownChapter {
  return {
    id: chapter.id,
    title: chapter.title,
    level: "locked",
    text: null,
    mediaUrl: null,
    partialRatio: null,
  };
}
