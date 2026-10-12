import { notFound } from "next/navigation";
import { ChapterList } from "@/components/chapters";
import { ViewCount, WorkActions } from "@/components/work-actions";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";
import { formatDateTime } from "@/lib/format";
import { TYPE_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { hasPaidAccess, pendingOrder } from "@/lib/orders";
import { showChapters } from "@/lib/preview";
import { getChapters, getWork, hasLiked } from "@/lib/works";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const work = getWork(getDb(), Number((await params).id));
  return { title: work?.title || "作品" };
}

export default async function WorkPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const db = getDb();
  const user = await getCurrentUser();
  const work = getWork(db, id);
  if (!work) notFound();
  const isAuthor = user?.id === work.author_id;
  if (work.status !== "published" && !isAuthor) notFound();
  const owned = hasPaidAccess(db, user?.id ?? null, work.id);
  const unlocked = isAuthor || owned || work.price_cents === 0;
  const chapters = showChapters(getChapters(db, work.id), {
    type: work.type,
    previewMode: work.preview_mode,
    previewPercent: work.preview_percent,
    unlocked,
  });
  const pending = user ? pendingOrder(db, user.id, work.id) : null;

  return (
    <article className="stack">
      <div className="work-hero">
        <div className="work-cover">
          {work.cover_path ? <img src={`/media/${work.cover_path}`} alt="" /> : <img src="/brand/ncstar-icon.jpg" alt="" />}
        </div>
        <div className="stack">
          <div className="actions">
            <span className={`pill pill-${work.type}`}>{TYPE_LABEL[work.type]}</span>
            {work.status === "scheduled" ? <span className="pill">定时投稿 · {formatDateTime(work.publish_at)}</span> : null}
            <span className="pill">{work.preview_mode === "progress" ? `预览进度 ${work.preview_percent}%` : "预览指定内容"}</span>
          </div>
          <h1>{work.title}</h1>
          <p className="muted">{work.author_name}</p>
          <p>{work.summary}</p>
          <p className="price">{work.price_cents === 0 ? "免费" : `${formatCents(work.price_cents)} 元（${work.price_cents} 分）`}</p>
          <p className="meta">
            <ViewCount workId={work.id} initial={work.view_count || 0} track={Boolean(user) && work.status === "published"} />
            <span>点赞 {work.like_count || 0}</span>
          </p>
          <WorkActions
            workId={work.id}
            priceCents={work.price_cents}
            initialLikes={work.like_count || 0}
            initialLiked={hasLiked(db, user?.id ?? null, work.id)}
            loggedIn={Boolean(user)}
            isAuthor={isAuthor}
            owned={owned || Boolean(pending && pending.status === "paid")}
            loginHref={`/login?next=${encodeURIComponent(`/works/${work.id}`)}`}
          />
          {pending ? <p className="muted">你有一张待支付订单 {pending.order_no}。去支付会继续使用这张订单，不会把它标成已支付。</p> : null}
        </div>
      </div>
      <ChapterList chapters={chapters} previewPercent={work.preview_percent} />
    </article>
  );
}
