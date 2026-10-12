import Link from "next/link";
import { getDb } from "@/lib/db";
import { formatCents, formatHeat } from "@/lib/money";
import { TYPE_LABEL, type WorkType } from "@/lib/labels";
import { listPublished } from "@/lib/works";

const TYPES = ["novel", "comic", "video"] as const;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; sort?: string }>;
}) {
  const query = await searchParams;
  const type = TYPES.includes(query.type as WorkType) ? (query.type as WorkType) : null;
  const sort = query.sort === "heat" ? "heat" : "latest";
  const works = listPublished(getDb(), { sort, type });

  function href(nextType: string | null, nextSort: "latest" | "heat") {
    const params = new URLSearchParams();
    if (nextType) params.set("type", nextType);
    if (nextSort === "heat") params.set("sort", "heat");
    const text = params.toString();
    return text ? `/?${text}` : "/";
  }

  return (
    <div>
      <section className="hero">
        <img src="/brand/ncstar-icon.jpg" alt="" />
        <div>
          <p className="eyebrow">小说 · 漫画 · 视频</p>
          <h1>NCstar</h1>
          <p className="lede">故事、画格和影像在同一片星空下。登录之后的浏览才计数，每个账号只贡献一次。</p>
        </div>
      </section>
      <div className="toolbar">
        <Link className="chip" href={href(null, sort)} aria-current={type === null ? "page" : undefined}>全部</Link>
        {TYPES.map((item) => (
          <Link key={item} className="chip" href={href(item, sort)} aria-current={type === item ? "page" : undefined}>
            {TYPE_LABEL[item]}
          </Link>
        ))}
      </div>
      <div className="sortbar" aria-label="排序">
        <Link href={href(type, "latest")} aria-current={sort === "latest" ? "page" : undefined}>最新</Link>
        <Link href={href(type, "heat")} aria-current={sort === "heat" ? "page" : undefined}>热度</Link>
      </div>
      <p className="rule">
        热度按点赞人数和浏览人数的比例排序。浏览人数超过 100 才进入热度榜，不足 100 的不显示。未登录的浏览不计，一个账号只计一次。
      </p>
      {works.length === 0 ? (
        <div className="empty">
          {sort === "heat" ? "还没有作品进入热度榜。" : "还没有发布的作品。"}
        </div>
      ) : (
        <div className="grid">
          {works.map((work) => {
            const views = work.view_count || 0;
            const likes = work.like_count || 0;
            return (
              <Link key={work.id} href={`/works/${work.id}`} className="card">
                <div className="cover">
                  {work.cover_path ? <img src={`/media/${work.cover_path}`} alt="" /> : <img src="/brand/ncstar-icon.jpg" alt="" />}
                </div>
                <div className="card-body">
                  <span className={`pill pill-${work.type}`}>{TYPE_LABEL[work.type]}</span>
                  <h3>{work.title}</h3>
                  <p className="muted">{work.author_name}</p>
                  <p className="price">{work.price_cents === 0 ? "免费" : `¥${formatCents(work.price_cents)}`}</p>
                  <p className="meta">
                    <span>浏览 {views}</span>
                    <span>点赞 {likes}</span>
                    {sort === "heat" ? <span>热度 {formatHeat(likes, views)}</span> : null}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
