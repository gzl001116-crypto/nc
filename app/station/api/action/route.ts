import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { gatewayPay, gatewayRefund, gatewayReturnOnly, gatewaySettle, openCheckout } from "@/lib/gateway";
import { json, sameOrigin } from "@/lib/http";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "非法来源" }, 403);
  const body = (await request.json()) as { action?: string; params?: Record<string, string> };
  const config = getConfig();
  const opened = openCheckout(getDb(), body.params || {}, config.paymentSecret, config.appBaseUrl);
  if (!opened.ok) return json({ error: opened.error }, 400);
  try {
    if (body.action === "pay") {
      const result = await gatewayPay(getDb(), opened.row.order_no, config.paymentSecret, config.appBaseUrl);
      return json(result);
    }
    if (body.action === "return") {
      return json(gatewayReturnOnly(getDb(), opened.row.order_no, config.appBaseUrl));
    }
    if (body.action === "refund") {
      const result = await gatewayRefund(getDb(), opened.row.order_no, config.paymentSecret, config.appBaseUrl);
      return json(result);
    }
    if (body.action === "settle" || body.action === "settle-silent") {
      const result = await gatewaySettle(
        getDb(),
        opened.row.order_no,
        config.paymentSecret,
        config.appBaseUrl,
        body.action === "settle",
      );
      return json(result);
    }
    return json({ error: "未知操作" }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "支付站操作失败" }, 400);
  }
}
