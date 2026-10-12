import { cookies } from "next/headers";
import { registerUser } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { fail, json, sameOrigin } from "@/lib/http";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "非法来源" }, 403);
  try {
    const body = (await request.json()) as { email?: string; password?: string; displayName?: string; code?: string };
    const config = getConfig();
    const result = registerUser(
      getDb(),
      {
        email: body.email || "",
        password: body.password || "",
        displayName: body.displayName || "",
        code: body.code || "",
      },
      config.sessionSecret,
      config.bcryptRounds,
    );
    const jar = await cookies();
    jar.set(SESSION_COOKIE, result.token, sessionCookieOptions());
    return json({ ok: true, displayName: result.user.display_name });
  } catch (error) {
    return fail(error);
  }
}
