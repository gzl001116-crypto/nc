import { redirect } from "next/navigation";
import { IncomeActions } from "@/components/income-actions";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";
import { formatDateTime } from "@/lib/format";
import { SETTLEMENT_LABEL, TYPE_LABEL } from "@/lib/labels";
import { formatCents, formatFee } from "@/lib/money";
import { incomeByWork, listLedger } from "@/lib/orders";

export const metadata = { title: "收入" };

export default async function IncomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/income");
  const config = getConfig();
  const db = getDb();
  const summary = incomeByWork(db, user.id);
  const ledger = listLedger(db, user.id);
  const portalUrl = user.customer_no
    ? `${config.paymentBaseUrl}/customer/${encodeURIComponent(user.customer_no)}`
    : null;
  return (
    <div className="stack">
      <div>
        <h1>作者收入</h1>
        <p className="muted">
          NCstar 只展示账本，不向银行卡打款。已结算以支付站的通知或查询为准。平台分成 {formatFee(config.feeBps)}，按分向下取整。
          结算账户、提现和打款留在支付站，使用已绑定的同一个客户编号打开。
        </p>
      </div>
      <section className="panel">
        <IncomeActions customerNo={user.customer_no} portalUrl={portalUrl} />
      </section>
      <section className="panel">
        <h2>按作品汇总</h2>
        <p className="muted">已支付是买家已支付的订单总额。待结算和已结算是作者所得，已退款且尚未结算的收入会冲销。</p>
        {summary.length === 0 ? <p className="muted">还没有作品。</p> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>作品</th>
                  <th>已支付</th>
                  <th>待结算</th>
                  <th>已结算</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row) => (
                  <tr key={row.id}>
                    <td>{row.title}<br /><span className="muted">{TYPE_LABEL[row.type]}</span></td>
                    <td>{formatCents(row.paid_cents)} 元</td>
                    <td>{formatCents(row.pending_cents)} 元</td>
                    <td>{formatCents(row.settled_cents)} 元</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel">
        <h2>收入账本</h2>
        {ledger.length === 0 ? <p className="muted">支付回调确认后，才会记入收入。同一条回调重复到达只记一次。</p> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>作品</th>
                  <th>订单</th>
                  <th>总额</th>
                  <th>平台分成</th>
                  <th>作者所得</th>
                  <th>时间</th>
                  <th>结算</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((row) => (
                  <tr key={row.id}>
                    <td>{row.title}</td>
                    <td>{row.order_no}</td>
                    <td>{formatCents(row.gross_cents)} 元<br /><span className="muted">{row.gross_cents} 分</span></td>
                    <td>{formatCents(row.platform_fee_cents)} 元</td>
                    <td>{formatCents(row.author_cents)} 元</td>
                    <td>{formatDateTime(row.created_at)}{row.settled_at ? <><br /><span className="muted">结算 {formatDateTime(row.settled_at)}</span></> : null}</td>
                    <td>
                      <span className={`pill ${row.settlement_status === "settled" ? "pill-settled" : row.settlement_status === "pending" ? "pill-pending" : "pill-refunded"}`}>
                        {SETTLEMENT_LABEL[row.settlement_status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
