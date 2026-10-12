"use client";

import { useEffect, useState } from "react";
import { formatCents } from "@/lib/money";

export function ViewCount({ workId, initial, track }: { workId: number; initial: number; track: boolean }) {
  const [count, setCount] = useState(initial);
  useEffect(() => {
    if (!track) return;
    let ignore = false;
    void fetch(`/api/works/${workId}/view`, { method: "POST" })
      .then((response) => response.json())
      .then((data: { viewCount?: number }) => {
        if (!ignore && typeof data.viewCount === "number") setCount(data.viewCount);
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, [workId, track]);
  return <span>浏览 {count}</span>;
}

export function WorkActions({
  workId,
  priceCents,
  initialLikes,
  initialLiked,
  loggedIn,
  isAuthor,
  owned,
  loginHref,
}: {
  workId: number;
  priceCents: number;
  initialLikes: number;
  initialLiked: boolean;
  loggedIn: boolean;
  isAuthor: boolean;
  owned: boolean;
  loginHref: string;
}) {
  const [likes, setLikes] = useState(initialLikes);
  const [liked, setLiked] = useState(initialLiked);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function like() {
    setError("");
    if (!loggedIn) {
      location.href = loginHref;
      return;
    }
    const response = await fetch(`/api/works/${workId}/like`, { method: "POST" });
    const data = (await response.json()) as { liked?: boolean; likeCount?: number; error?: string };
    if (!response.ok || data.liked == null || data.likeCount == null) {
      setError(data.error || "点赞失败");
      return;
    }
    setLiked(data.liked);
    setLikes(data.likeCount);
  }

  async function buy() {
    setError("");
    setPending(true);
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workId }),
    });
    const data = (await response.json()) as { payUrl?: string; error?: string };
    setPending(false);
    if (!response.ok || !data.payUrl) {
      setError(data.error || "创建订单失败");
      return;
    }
    location.href = data.payUrl;
  }

  return (
    <div className="stack">
      <div className="actions">
        <button className="btn-line" type="button" onClick={like}>{liked ? "已点赞" : "点赞"} · {likes}</button>
        {priceCents <= 0 ? <span className="pill">免费</span> : null}
        {isAuthor ? <span className="muted">这是你的作品</span> : null}
        {!isAuthor && priceCents > 0 && owned ? <span className="pill pill-paid">已购买</span> : null}
        {!isAuthor && priceCents > 0 && !owned ? (
          loggedIn ? (
            <button className="btn-gold" type="button" onClick={buy} disabled={pending}>
              {pending ? "正在创建订单" : `支付 ${formatCents(priceCents)} 元`}
            </button>
          ) : (
            <a className="btn-gold" href={loginHref}>登录后购买</a>
          )
        ) : null}
      </div>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
