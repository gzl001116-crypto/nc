"use client";

import type { ShownChapter } from "@/lib/preview";

export function ChapterList({ chapters, previewPercent }: { chapters: ShownChapter[]; previewPercent: number }) {
  return (
    <div className="stack">
      {chapters.map((chapter) => (
        <article key={chapter.id} className="chapter">
          <div className="actions">
            <h3>{chapter.title}</h3>
            {chapter.level === "partial" ? <span className="pill">预览进度 {previewPercent}%</span> : null}
            {chapter.level === "locked" ? <span className="pill pill-locked">购买后阅读</span> : null}
          </div>
          {chapter.level === "locked" ? <p className="muted">这段内容尚未开放。</p> : null}
          {chapter.text ? (
            <div className="prose">
              {chapter.text.split("\n").map((line, index) => (
                <p key={index}>{line || " "}</p>
              ))}
            </div>
          ) : null}
          {chapter.mediaUrl && chapter.level !== "locked" ? (
            chapter.mediaUrl.endsWith(".mp4") || chapter.mediaUrl.endsWith(".webm") ? (
              <PreviewVideo src={chapter.mediaUrl} ratio={chapter.partialRatio} />
            ) : (
              <PreviewImage src={chapter.mediaUrl} alt={chapter.title} ratio={chapter.partialRatio} />
            )
          ) : null}
        </article>
      ))}
    </div>
  );
}

function PreviewImage({ src, alt, ratio }: { src: string; alt: string; ratio: number | null }) {
  return (
    <div className="clip-media" style={ratio == null ? undefined : { maxHeight: `${Math.max(96, Math.round(ratio * 520))}px` }}>
      <img src={src} alt={alt} />
    </div>
  );
}

function PreviewVideo({ src, ratio }: { src: string; ratio: number | null }) {
  return (
    <div className="clip-media">
      <video
        src={src}
        controls
        onTimeUpdate={(event) => {
          if (ratio == null) return;
          const video = event.currentTarget;
          const limit = video.duration * ratio;
          if (Number.isFinite(limit) && video.currentTime > limit) {
            video.currentTime = limit;
            video.pause();
          }
        }}
      />
    </div>
  );
}
