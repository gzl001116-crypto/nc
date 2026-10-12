import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";
import { formatDateTime } from "@/lib/format";
import { TYPE_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { listAuthorWorks } from "@/lib/works";

export const metadata = { title: "我的作品" };

export default async function StudioPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/studio");
  const works = listAuthorWorks(getDb(), user.id);
  return (
    <div className="stack">
      <div className="actions">
        <h1>我的作品</h1>
        <Link className="btn" href="/publish">投稿</Link>
      </div>
      <p className="muted">定时投稿在到达发布时间前只对你可见，到点后自动公开。</p>
      {works.length === 0 ? <div className="empty">还没有作品。</div> : (
        <div className="grid">
          {works.map((work) => (
            <Link key={work.id} href={`/works/${work.id}`} className="card">
              <div className="card-body">
                <span className={`pill pill-${work.type}`}>{TYPE_LABEL[work.type]}</span>
                <h3>{work.title}</h3>
                <p className="price">{work.price_cents === 0 ? "免费" : `¥${formatCents(work.price_cents)}`}</p>
                <p className="meta">
                  <span>{work.status === "published" ? "已发布" : "定时"}</span>
                  <span>{formatDateTime(work.published_at || work.publish_at)}</span>
                  <span>{work.preview_mode === "progress" ? `进度 ${work.preview_percent}%` : "指定内容"}</span>
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
