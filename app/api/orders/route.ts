import { getConfig } from "@/lib/config";
import { getCurrentUser } from "@/lib/current-user";
import { getDb } from "@/lib/db";
import { fail, json, sameOrigin } from "@/lib/http";
import { createOrder } from "@/lib/orders";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "非法来源" }, 403);
  const user = await getCurrentUser();
  if (!user) return json({ error: "请先登录" }, 401);
  try {
    const body = (await request.json()) as { workId?: number };
    const workId = Number(body.workId);
    if (!Number.isInteger(workId)) return json({ error: "作品无效" }, 400);
    const config = getConfig();
    const result = createOrder(getDb(), user.id, workId, {
      paymentBaseUrl: config.paymentBaseUrl,
      appBaseUrl: config.appBaseUrl,
      secret: config.paymentSecret,
    });
    return json({
      orderNo: result.order.order_no,
      status: result.order.status,
      amountCents: result.order.amount_cents,
      payUrl: result.payUrl,
    });
  } catch (error) {
    return fail(error);
  }
}
