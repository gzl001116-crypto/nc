import type { Metadata } from "next";
import { connection } from "next/server";
import { Header } from "@/components/header";
import { getCurrentUser } from "@/lib/current-user";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "NCstar", template: "%s · NCstar" },
  description: "NCstar 小说、漫画与视频",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const user = await getCurrentUser();
  return (
    <html lang="zh-CN">
      <body>
        <Header user={user ? { displayName: user.display_name, customerNo: user.customer_no } : null} />
        <main>{children}</main>
        <footer className="site-footer">NCstar 只展示收入账本，不向银行卡打款。结算账户、提现和打款在支付站办理。</footer>
      </body>
    </html>
  );
}
