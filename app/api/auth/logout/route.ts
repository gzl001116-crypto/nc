import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { json, sameOrigin } from "@/lib/http";
import { SESSION_COOKIE, deleteSession } from "@/lib/session";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "非法来源" }, 403);
  const jar = await cookies();
  deleteSession(getDb(), jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  return json({ ok: true });
}
