import { one } from "@/lib/db";
import { getDb } from "@/lib/db";

export const metadata = { title: "支付站客户" };

export default async function CustomerPortalPage({ params }: { params: Promise<{ customerNo: string }> }) {
  const customerNo = decodeURIComponent((await params).customerNo);
  const user = /^[A-Za-z0-9_-]{2,64}$/.test(customerNo)
    ? one<{ display_name: string }>(getDb(), `SELECT display_name FROM users WHERE customer_no = ?`, customerNo)
    : undefined;
  return (
    <div className="stack">
      <section className="station-banner">
        <h1>支付站客户 {customerNo}</h1>
        <p>{user ? `这个编号当前绑定 NCstar 用户 ${user.display_name}。` : "支付站按客户编号识别结算账户。"} NCstar 使用同一个编号打开这里。</p>
      </section>
      <section className="station-card">
        <h2>结算账户</h2>
        <p>账户资料留在支付站。NCstar 只记录客户编号，不保存银行卡。</p>
      </section>
      <section className="station-card">
        <h2>提现</h2>
        <p>提现从这里发起。NCstar 不向银行卡打款，也不代付。</p>
      </section>
      <section className="station-card">
        <h2>打款</h2>
        <p>打款由支付站处理。NCstar 收入页里的已结算，只反映支付站的通知或查询结果。</p>
      </section>
    </div>
  );
}
