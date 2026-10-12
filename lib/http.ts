import { InputError } from "./errors";

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function fail(error: unknown): Response {
  if (error instanceof InputError) return json({ error: error.message }, error.status);
  console.error(error);
  return json({ error: "请求失败" }, 500);
}
