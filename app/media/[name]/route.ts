import fs from "fs";
import { mediaFile, mediaType } from "@/lib/media";

export async function GET(_request: Request, context: { params: Promise<{ name: string }> }) {
  const name = (await context.params).name;
  const file = mediaFile(name);
  if (!file || !fs.existsSync(file)) return new Response("没有这个文件", { status: 404 });
  const data = fs.readFileSync(file);
  return new Response(data, {
    headers: {
      "content-type": mediaType(name),
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
