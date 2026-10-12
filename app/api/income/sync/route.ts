import { getConfig } from "@/lib/config";
import { getCurrentUser } from "@/lib/current-user";
import { getDb } from "@/lib/db";
import { fail, json, sameOrigin } from "@/lib/http";
import { syncAuthorSettlements } from "@/lib/orders";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "非法来源" }, 403);
  const user = await getCurrentUser();
  if (!user) return json({ error: "请先登录" }, 401);
  try {
    const config = getConfig();
    const result = await syncAuthorSettlements(getDb(), user.id, {
      paymentBaseUrl: config.paymentBaseUrl,
      secret: config.paymentSecret,
    });
    return json(result);
  } catch (error) {
    return fail(error);
  }
}
