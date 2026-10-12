import Link from "next/link";
import { redirect } from "next/navigation";
import { PayButton } from "@/components/pay-button";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";
import { ORDER_STATUS_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { readReturnState } from "@/lib/orders";

export const metadata = { title: "支付结果" };

export default async function PayReturnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  const raw = await searchParams;
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const text = Array.isArray(value) ? value[0] : value;
    if (text) query[key] = text;
  }
  const orderNo = query.order_no || "";
  if (!user) redirect(`/login?next=${encodeURIComponent(`/pay/return?order_no=${orderNo}`)}`);
  const { order, forged } = readReturnState(getDb(), orderNo, query);
  if (!order) {
    return <div className="empty"><h1>没有这张订单</h1><p>返回页只展示站内订单，不会凭跳转参数创建或支付。</p></div>;
  }
  if (order.buyer_id !== user.id && order.author_id !== user.id) {
    return <div className="empty"><h1>无权查看</h1></div>;
  }
  return (
    <section className="panel stack">
      <h1>支付结果</h1>
      <p>这里只展示 NCstar 已经保存的订单状态。从支付站跳回来，不能当成付款成功。</p>
      {forged ? <p className="warn">链接里带有支付成功标记，NCstar 已忽略。只有支付站回调验签通过，订单才会变成已支付。</p> : null}
      <p className={`pill pill-${order.status}`}>{ORDER_STATUS_LABEL[order.status]}</p>
      <p>订单号 {order.order_no}</p>
      <p>买家 {order.buyer_name} · 作者 {order.author_name}</p>
      <p>作品 <Link href={`/works/${order.work_id}`}>{order.title}</Link></p>
      <p>金额 {formatCents(order.amount_cents)} 元（{order.amount_cents} 分）</p>
      {order.status === "pending" ? <p className="muted">订单仍是待支付。如果已经在支付站付款，请等待回调，不要把这个页面当作成功凭证。</p> : null}
      {order.status === "pending" && order.buyer_id === user.id ? <PayButton workId={order.work_id} label="返回支付站" /> : null}
      <div className="actions">
        <Link className="btn" href="/orders">查看订单</Link>
        <Link className="btn-line" href={`/works/${order.work_id}`}>返回作品</Link>
      </div>
    </section>
  );
}
