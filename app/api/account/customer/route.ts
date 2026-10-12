import { bindCustomer } from "@/lib/auth";
import { getCurrentUser } from "@/lib/current-user";
import { getDb } from "@/lib/db";
import { fail, json, sameOrigin } from "@/lib/http";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "非法来源" }, 403);
  const user = await getCurrentUser();
  if (!user) return json({ error: "请先登录" }, 401);
  try {
    const body = (await request.json()) as { customerNo?: string };
    bindCustomer(getDb(), user.id, body.customerNo || "");
    return json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
