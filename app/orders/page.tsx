import { redirect } from "next/navigation";
import { PayButton } from "@/components/pay-button";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";
import { formatDateTime } from "@/lib/format";
import { ORDER_STATUS_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { listAuthorOrders, listBuyerOrders, type OrderView } from "@/lib/orders";

export const metadata = { title: "订单" };

export default async function OrdersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/orders");
  const db = getDb();
  const bought = listBuyerOrders(db, user.id);
  const sold = listAuthorOrders(db, user.id);
  return (
    <div className="stack">
      <div>
        <h1>订单</h1>
        <p className="muted">订单包含订单号、买家、作者、作品、金额和状态。创建订单不会收款，付款结果只认支付站回调。</p>
      </div>
      <OrderTable title="我购买的" orders={bought} payable />
      <OrderTable title="我卖出的" orders={sold} payable={false} />
    </div>
  );
}

function OrderTable({ title, orders, payable }: { title: string; orders: OrderView[]; payable: boolean }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {orders.length === 0 ? <p className="muted">还没有订单。</p> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>订单号</th>
                <th>买家</th>
                <th>作者</th>
                <th>作品</th>
                <th>金额</th>
                <th>状态</th>
                <th>时间</th>
                {payable ? <th></th> : null}
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>{order.order_no}</td>
                  <td>{order.buyer_name}</td>
                  <td>{order.author_name}</td>
                  <td><a href={`/works/${order.work_id}`}>{order.title}</a></td>
                  <td>{formatCents(order.amount_cents)} 元<br /><span className="muted">{order.amount_cents} 分</span></td>
                  <td><span className={`pill pill-${order.status}`}>{ORDER_STATUS_LABEL[order.status]}</span></td>
                  <td>{formatDateTime(order.paid_at || order.created_at)}</td>
                  {payable ? <td>{order.status === "pending" ? <PayButton workId={order.work_id} label="去支付" /> : null}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
