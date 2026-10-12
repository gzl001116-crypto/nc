import { getCurrentUser } from "@/lib/current-user";
import { getDb } from "@/lib/db";
import { fail, json, sameOrigin } from "@/lib/http";
import { toggleLike } from "@/lib/works";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return json({ error: "非法来源" }, 403);
  const user = await getCurrentUser();
  if (!user) return json({ error: "请先登录" }, 401);
  const id = Number((await context.params).id);
  if (!Number.isInteger(id)) return json({ error: "作品不存在" }, 404);
  try {
    return json(toggleLike(getDb(), user.id, id));
  } catch (error) {
    return fail(error);
  }
}
