import { getCurrentUser } from "@/lib/current-user";
import { getDb } from "@/lib/db";
import { fail, json, sameOrigin } from "@/lib/http";
import { createWorkFromForm } from "@/lib/publish";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "非法来源" }, 403);
  const user = await getCurrentUser();
  if (!user) return json({ error: "请先登录" }, 401);
  try {
    const id = await createWorkFromForm(getDb(), user.id, await request.formData());
    return json({ id });
  } catch (error) {
    return fail(error);
  }
}
