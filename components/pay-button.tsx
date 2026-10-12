"use client";

import { useState } from "react";

export function PayButton({ workId, label }: { workId: number; label: string }) {
  const [error, setError] = useState("");
  async function pay() {
    setError("");
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workId }),
    });
    const data = (await response.json()) as { payUrl?: string; error?: string };
    if (!response.ok || !data.payUrl) {
      setError(data.error || "暂时不能支付");
      return;
    }
    location.href = data.payUrl;
  }
  return (
    <div>
      <button className="btn-gold" type="button" onClick={pay}>{label}</button>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
