import { mkdir, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { del, put } from "@vercel/blob";

const MAX_BYTES = 5 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

const ALLOWED = new Set(Object.keys(MIME_TO_EXT));

function blobUploadsEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function isBlobPublicUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) && url.includes("blob.vercel-storage.com");
}

export function webPathToAbsolute(webPath: string): string | null {
  if (!webPath.startsWith("/uploads/")) return null;
  const rel = webPath.replace(/^\//, "");
  return join(process.cwd(), "public", rel);
}

export async function deleteFileIfInUploads(webPath: string | undefined): Promise<void> {
  if (!webPath) return;

  if (isBlobPublicUrl(webPath)) {
    try {
      await del(webPath, {
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
    } catch {
      /* ignore */
    }
    return;
  }

  if (!webPath.startsWith("/uploads/")) return;
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

  if (blobUploadsEnabled()) {
    const pathname = `uploads/${sub}/${safe}.${ext}`;
    const blob = await put(pathname, file, {
      access: "public",
      token: process.env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: true,
    });
    return { ok: true, webPath: blob.url };
  }

  const webPath = `/uploads/${sub}/${safe}.${ext}`;
  const absDir = join(process.cwd(), "public", "uploads", sub);
  const absFile = join(absDir, `${safe}.${ext}`);

  await mkdir(absDir, { recursive: true });
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(absFile, buf);

  return { ok: true, webPath };
}
