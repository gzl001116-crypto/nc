"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type HeaderUser = { displayName: string; customerNo: string | null } | null;

const LINKS = [
  { href: "/", label: "首页" },
  { href: "/?type=novel", label: "小说" },
  { href: "/?type=comic", label: "漫画" },
  { href: "/?type=video", label: "视频" },
];

export function Header({ user }: { user: HeaderUser }) {
  const pathname = usePathname();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/";
  }
  return (
    <header className="site-header">
      <div className="brand">
        <Link href="/" className="brand">
          <img src="/brand/ncstar-icon.jpg" alt="" />
          <span className="wordmark">NCstar</span>
        </Link>
      </div>
      <nav className="nav" aria-label="分类">
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href} aria-current={pathname === "/" && link.href === "/" ? "page" : undefined}>
            {link.label}
          </Link>
        ))}
      </nav>
      <nav className="account-nav" aria-label="账号">
        <Link href="/publish">投稿</Link>
        <Link href="/studio">作品</Link>
        <Link href="/orders">订单</Link>
        <Link href="/income">收入</Link>
        {user ? (
          <>
            <span className="who">{user.displayName}</span>
            <button className="text-button" type="button" onClick={logout}>退出</button>
          </>
        ) : (
          <>
            <Link href="/login">登录</Link>
            <Link href="/register">注册</Link>
          </>
        )}
      </nav>
    </header>
  );
}
