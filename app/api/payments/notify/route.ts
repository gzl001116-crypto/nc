import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { json } from "@/lib/http";
import { handlePaymentNotify } from "@/lib/orders";

export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > 20_000) return json({ error: "通知过大" }, 413);
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return json({ error: "通知不是 JSON" }, 400);
  }
  try {
    const config = getConfig();
    const result = handlePaymentNotify(getDb(), payload, config.paymentSecret, config.feeBps);
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ ok: true, duplicate: Boolean(result.duplicate) });
  } catch (error) {
    console.error(error);
    return json({ error: "回调处理失败" }, 500);
  }
}
