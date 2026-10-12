import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { gatewayQuery } from "@/lib/gateway";
import { json } from "@/lib/http";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  const result = gatewayQuery(getDb(), params, getConfig().paymentSecret);
  return json(result.body, result.status);
}
