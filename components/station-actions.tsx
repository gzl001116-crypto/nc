"use client";

import { useState } from "react";

export function StationActions({ params }: { params: Record<string, string> }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function run(action: string) {
    setError("");
    setMessage("");
    const response = await fetch("/station/api/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, params }),
    });
    const data = (await response.json()) as { error?: string; redirect?: string; notifyStatus?: number | null; notifyBody?: string };
    if (!response.ok) {
      setError(data.error || "支付站操作失败");
      return;
    }
    if (data.redirect && (action === "pay" || action === "return")) {
      location.href = data.redirect;
      return;
    }
    setMessage(`支付站已处理。回调状态 ${data.notifyStatus ?? "未发送"}。${data.notifyBody || ""}`);
  }

  return (
    <div className="stack">
      <div className="actions">
        <button className="btn-gold" type="button" onClick={() => run("pay")}>确认支付并回调</button>
        <button className="btn-line" type="button" onClick={() => run("return")}>只跳回，不回调</button>
      </div>
      <div className="actions">
        <button className="btn-line" type="button" onClick={() => run("refund")}>模拟退款回调</button>
        <button className="btn-line" type="button" onClick={() => run("settle")}>结算并通知 NCstar</button>
        <button className="btn-line" type="button" onClick={() => run("settle-silent")}>只在支付站标记已结算</button>
      </div>
      {message ? <p className="muted">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
