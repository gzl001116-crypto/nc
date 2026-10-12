"use client";

import { useState } from "react";
import { yuanToCents, formatCents } from "@/lib/money";

type Draft = { key: string; title: string; body: string; preview: boolean; file: File | null };

let keySeed = 1;

export function PublishForm() {
  const [type, setType] = useState<"novel" | "comic" | "video">("novel");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [priceYuan, setPriceYuan] = useState("0.00");
  const [previewMode, setPreviewMode] = useState<"progress" | "content">("progress");
  const [previewPercent, setPreviewPercent] = useState(30);
  const [publishMode, setPublishMode] = useState<"now" | "schedule">("now");
  const [publishAt, setPublishAt] = useState("");
  const [cover, setCover] = useState<File | null>(null);
  const [chapters, setChapters] = useState<Draft[]>([{ key: "c1", title: "第 1 段", body: "", preview: true, file: null }]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const cents = yuanToCents(priceYuan);

  function update(key: string, patch: Partial<Draft>) {
    setChapters((items) => items.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (cents === null) {
      setError("价格格式不正确，最多两位小数");
      return;
    }
    setPending(true);
    const form = new FormData();
    form.set("type", type);
    form.set("title", title);
    form.set("summary", summary);
    form.set("priceYuan", priceYuan.trim());
    form.set("previewMode", previewMode);
    form.set("previewPercent", String(previewPercent));
    form.set("publishMode", publishMode);
    form.set("publishAt", publishAt);
    if (cover) form.set("cover", cover);
    form.set(
      "chapters",
      JSON.stringify(chapters.map((chapter) => ({ title: chapter.title, body: chapter.body, isPreview: chapter.preview }))),
    );
    chapters.forEach((chapter, index) => {
      if (chapter.file) form.set(`chapterFile_${index}`, chapter.file);
    });
    const response = await fetch("/api/works", { method: "POST", body: form });
    const data = (await response.json()) as { id?: number; error?: string };
    setPending(false);
    if (!response.ok || !data.id) {
      setError(data.error || "发布失败");
      return;
    }
    location.href = `/works/${data.id}`;
  }

  return (
    <form className="panel stack" onSubmit={submit}>
      <div>
        <h1>投稿</h1>
        <p className="muted">发布小说、漫画或视频。可以选择按进度预览，或指定可预览的内容。定时投稿会在到达时间后公开。</p>
      </div>
      <div className="choice" role="radiogroup" aria-label="类型">
        {(["novel", "comic", "video"] as const).map((item) => (
          <label key={item}>
            <input type="radio" name="type" checked={type === item} onChange={() => setType(item)} />
            {item === "novel" ? "小说" : item === "comic" ? "漫画" : "视频"}
          </label>
        ))}
      </div>
      <label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} required /></label>
      <label>简介<textarea value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={500} required /></label>
      <label>
        封面
        <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={(event) => setCover(event.target.files?.[0] ?? null)} />
      </label>
      <label>
        价格（元）
        <input value={priceYuan} onChange={(event) => setPriceYuan(event.target.value)} inputMode="decimal" required />
      </label>
      <p className="muted">金额按分保存为整数。当前是 {cents === null ? "无效金额" : `${cents} 分，展示为 ${formatCents(cents)} 元`}。</p>
      <div className="choice">
        <label><input type="radio" checked={previewMode === "progress"} onChange={() => setPreviewMode("progress")} />按进度预览</label>
        <label><input type="radio" checked={previewMode === "content"} onChange={() => setPreviewMode("content")} />按内容预览</label>
      </div>
      {previewMode === "progress" ? (
        <label>
          可预览进度 {previewPercent}%
          <input type="range" min={0} max={100} value={previewPercent} onChange={(event) => setPreviewPercent(Number(event.target.value))} />
        </label>
      ) : (
        <p className="muted">勾选下面的段落，未购买的读者只能看到这些内容。</p>
      )}
      <div className="choice">
        <label><input type="radio" checked={publishMode === "now"} onChange={() => setPublishMode("now")} />立即发布</label>
        <label><input type="radio" checked={publishMode === "schedule"} onChange={() => setPublishMode("schedule")} />定时投稿</label>
      </div>
      {publishMode === "schedule" ? (
        <label>发布时间<input type="datetime-local" value={publishAt} onChange={(event) => setPublishAt(event.target.value)} required /></label>
      ) : null}
      <div className="stack">
        {chapters.map((chapter, index) => (
          <fieldset key={chapter.key} className="stack">
            <legend>第 {index + 1} 段</legend>
            <label>标题<input value={chapter.title} onChange={(event) => update(chapter.key, { title: event.target.value })} required /></label>
            {type === "novel" ? (
              <label>正文<textarea value={chapter.body} onChange={(event) => update(chapter.key, { body: event.target.value })} required /></label>
            ) : (
              <label>
                {type === "comic" ? "图片" : "视频"}
                <input
                  type="file"
                  accept={type === "comic" ? "image/jpeg,image/png,image/gif,image/webp" : "video/mp4,video/webm"}
                  onChange={(event) => update(chapter.key, { file: event.target.files?.[0] ?? null })}
                  required
                />
              </label>
            )}
            {previewMode === "content" ? (
              <label className="choice">
                <input type="checkbox" checked={chapter.preview} onChange={(event) => update(chapter.key, { preview: event.target.checked })} />
                作为预览内容
              </label>
            ) : null}
            {chapters.length > 1 ? (
              <button className="btn-line" type="button" onClick={() => setChapters((items) => items.filter((item) => item.key !== chapter.key))}>删除这段</button>
            ) : null}
          </fieldset>
        ))}
        <button
          className="btn-line"
          type="button"
          onClick={() => {
            keySeed += 1;
            setChapters((items) => [...items, { key: `c${keySeed}`, title: `第 ${items.length + 1} 段`, body: "", preview: false, file: null }]);
          }}
        >
          添加一段
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <button className="btn" disabled={pending} type="submit">{pending ? "发布中" : "发布作品"}</button>
    </form>
  );
}
