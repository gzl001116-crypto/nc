import fs from "fs";
import path from "path";
import crypto from "crypto";
import { InputError } from "./errors";

const ROOT = path.join(process.cwd(), "data", "media");
const MAX = 32 * 1024 * 1024;

export function mediaFile(name: string): string | null {
  if (!/^[a-f0-9]{32}\.(jpg|png|gif|webp|mp4|webm)$/.test(name)) return null;
  const full = path.join(ROOT, name);
  if (!full.startsWith(ROOT)) return null;
  return full;
}

export async function saveMedia(file: File, kind: "image" | "video"): Promise<string> {
  if (file.size <= 0) throw new InputError("文件是空的");
  if (file.size > MAX) throw new InputError("文件不能超过 32MB");
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = kind === "video" ? sniffVideo(buffer) : sniffImage(buffer);
  const name = crypto.randomBytes(16).toString("hex") + ext;
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(path.join(ROOT, name), buffer);
  return name;
}

function sniffImage(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  if (buf.length >= 6) {
    const head = buf.subarray(0, 6).toString("ascii");
    if (head === "GIF87a" || head === "GIF89a") return ".gif";
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    return ".webp";
  }
  throw new InputError("图片请上传 JPG、PNG、GIF 或 WebP");
}

function sniffVideo(buf: Buffer): string {
  if (buf.length >= 12 && buf.subarray(4, 8).toString("ascii") === "ftyp") return ".mp4";
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return ".webm";
  throw new InputError("视频请上传 MP4 或 WebM");
}

export function mediaType(name: string): string {
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".mp4")) return "video/mp4";
  if (name.endsWith(".webm")) return "video/webm";
  return "image/jpeg";
}
