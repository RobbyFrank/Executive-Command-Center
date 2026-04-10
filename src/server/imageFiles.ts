import { mkdir, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const MAX_BYTES = 5 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

const ALLOWED = new Set(Object.keys(MIME_TO_EXT));

export function webPathToAbsolute(webPath: string): string | null {
  if (!webPath.startsWith("/uploads/")) return null;
  const rel = webPath.replace(/^\//, "");
  return join(process.cwd(), "public", rel);
}

export async function deleteFileIfInUploads(webPath: string | undefined): Promise<void> {
  if (!webPath?.startsWith("/uploads/")) return;
  const abs = webPathToAbsolute(webPath);
  if (!abs) return;
  try {
    if (existsSync(abs)) await unlink(abs);
  } catch {
    /* ignore */
  }
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64) || "asset";
}

export type SaveUploadResult =
  | { ok: true; webPath: string }
  | { ok: false; error: string };

export async function saveUploadedImage(args: {
  kind: "company" | "person";
  entityId: string;
  file: File;
}): Promise<SaveUploadResult> {
  const { kind, entityId, file } = args;

  if (!file || file.size === 0) {
    return { ok: false, error: "No file selected" };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Image must be 5MB or smaller" };
  }

  const mime = file.type;
  if (!ALLOWED.has(mime)) {
    return {
      ok: false,
      error: "Use a JPEG, PNG, WebP, GIF, or SVG image",
    };
  }

  const ext = MIME_TO_EXT[mime];
  const safe = sanitizeId(entityId);
  const sub = kind === "company" ? "companies" : "people";
  const webPath = `/uploads/${sub}/${safe}.${ext}`;
  const absDir = join(process.cwd(), "public", "uploads", sub);
  const absFile = join(absDir, `${safe}.${ext}`);

  await mkdir(absDir, { recursive: true });
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(absFile, buf);

  return { ok: true, webPath };
}
