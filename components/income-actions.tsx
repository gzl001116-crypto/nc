"use client";

import { useState } from "react";

export function IncomeActions({
  customerNo,
  portalUrl,
}: {
  customerNo: string | null;
  portalUrl: string | null;
}) {
  const [value, setValue] = useState(customerNo || "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function bind(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    const response = await fetch("/api/account/customer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerNo: value }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(data.error || "绑定失败");
      return;
    }
    location.reload();
  }

  async function sync() {
    setError("");
    setMessage("");
    const response = await fetch("/api/income/sync", { method: "POST" });
    const data = (await response.json()) as { updated?: number; errors?: number; error?: string };
    if (!response.ok) {
      setError(data.error || "同步失败");
      return;
    }
    setMessage(`已向支付站查询。更新 ${data.updated ?? 0} 笔，失败 ${data.errors ?? 0} 笔。`);
    window.setTimeout(() => location.reload(), 600);
  }

  return (
    <div className="stack">
      <form className="actions" onSubmit={bind}>
        <label>
          支付站客户编号
          <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="例如 CST10001" />
        </label>
        <button className="btn" type="submit">{customerNo ? "更新编号" : "绑定编号"}</button>
      </form>
      <div className="actions">
        <button className="btn-line" type="button" onClick={sync}>向支付站查询结算状态</button>
        {portalUrl ? (
          <a className="btn-gold" href={portalUrl}>打开支付站办理结算账户、提现和打款</a>
        ) : (
          <span className="muted">绑定客户编号后，才能打开支付站的结算账户。</span>
        )}
      </div>
      {message ? <p className="muted">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
