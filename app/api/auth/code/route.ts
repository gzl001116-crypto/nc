import { issueEmailCode } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { fail, json, sameOrigin } from "@/lib/http";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "非法来源" }, 403);
  try {
    const body = (await request.json()) as { email?: string; purpose?: string };
    if (body.purpose !== "register" && body.purpose !== "login") return json({ error: "用途无效" }, 400);
    await issueEmailCode(getDb(), body.email || "", body.purpose, getConfig().sessionSecret);
    return json({
      ok: true,
      message: body.purpose === "login" ? "如果这个邮箱已注册，验证码已发送。" : "验证码已发送。",
    });
  } catch (error) {
    return fail(error);
  }
}
