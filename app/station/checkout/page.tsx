import { formatCents } from "@/lib/money";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { openCheckout, queryToParams } from "@/lib/gateway";
import { StationActions } from "@/components/station-actions";

export const metadata = { title: "支付站收银台" };

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = queryToParams(await searchParams);
  const config = getConfig();
  const opened = openCheckout(getDb(), params, config.paymentSecret, config.appBaseUrl);
  return (
    <div className="stack">
      <section className="station-banner">
        <h1>支付站</h1>
        <p>这里不是 NCstar。确认支付后，支付站用双方约定的密钥回调。只跳回不会改变订单。</p>
      </section>
      {!opened.ok ? <div className="empty"><h2>无法收款</h2><p>{opened.error}</p></div> : (
        <section className="station-card stack">
          <h2>{opened.row.subject}</h2>
          <p>订单号 {opened.row.order_no}</p>
          <p>买家 {opened.row.buyer_name || "—"}</p>
          <p>作者客户编号 {opened.row.author_customer_no || "未绑定"}</p>
          <p className="price">{formatCents(opened.row.amount_cents)} 元（{opened.row.amount_cents} 分）</p>
          <p className="muted">支付站状态：{opened.row.status === "unpaid" ? "未支付" : opened.row.status === "paid" ? "已支付" : "已退款"} · 结算：{opened.row.settlement_status === "settled" ? "已结算" : "待结算"}</p>
          <StationActions params={params} />
        </section>
      )}
    </div>
  );
}
