import { getCurrentUser } from "@/lib/current-user";
import { getDb } from "@/lib/db";
import { json, sameOrigin } from "@/lib/http";
import { recordView } from "@/lib/works";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return json({ error: "非法来源" }, 403);
  const id = Number((await context.params).id);
  if (!Number.isInteger(id)) return json({ error: "作品不存在" }, 404);
  const user = await getCurrentUser();
  const result = recordView(getDb(), user?.id ?? null, id);
  return json(result);
}
