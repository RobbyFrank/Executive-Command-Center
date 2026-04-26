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

function normalizeImageMime(raw: string | undefined): string {
  const m = raw?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (m === "image/jpg") return "image/jpeg";
  return m;
}

function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buf.length >= 6 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38
  ) {
    return "image/gif";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  const head = buf.subarray(0, Math.min(256, buf.length)).toString("utf8").trimStart();
  if (head.startsWith("<?xml") || head.startsWith("<svg")) {
    return "image/svg+xml";
  }
  return null;
}

/**
 * Download a remote image and store it in the same place as a manual upload.
 * Falls back to writing under `public/uploads/...` when Vercel Blob is not configured (local dev).
 */
export async function saveImageFromRemoteUrl(args: {
  kind: "company" | "person";
  entityId: string;
  imageUrl: string;
  /** Network timeout for downloading the source image. Defaults to 30s. */
  timeoutMs?: number;
}): Promise<SaveUploadResult> {
  const { kind, entityId, imageUrl, timeoutMs = 30_000 } = args;

  const url = imageUrl?.trim();
  if (!url) {
    return { ok: false, error: "No image URL" };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        // Some hosts (e.g. site CDNs) reject default fetch UA; pretend to be a real browser.
        "User-Agent":
          "Mozilla/5.0 (compatible; ExecutiveCommandCenter/1.0; +image-fetch)",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });
  } catch {
    return { ok: false, error: "Could not download image (network error)." };
  }

  if (!res.ok) {
    return {
      ok: false,
      error: `Could not download image (${res.status}).`,
    };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) {
    return { ok: false, error: "Empty image" };
  }
  if (buf.length > MAX_BYTES) {
    return { ok: false, error: "Image must be 5MB or smaller" };
  }

  let mime = normalizeImageMime(res.headers.get("content-type") ?? undefined);
  if (!ALLOWED.has(mime)) {
    const sniffed = sniffImageMime(buf);
    if (sniffed) mime = sniffed;
  }

  if (!ALLOWED.has(mime)) {
    return {
      ok: false,
      error: "Downloaded file is not a supported image (JPEG, PNG, WebP, GIF, or SVG).",
    };
  }

  const ext = MIME_TO_EXT[mime];
  const safe = sanitizeId(entityId);
  const sub = kind === "company" ? "companies" : "people";

  if (blobUploadsEnabled()) {
    const pathname = `uploads/${sub}/${safe}.${ext}`;
    const blob = await put(pathname, buf, {
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
  await writeFile(absFile, buf);
  return { ok: true, webPath };
}

/**
 * Download a Slack profile photo and store it (Vercel Blob in prod; local in dev).
 * Wrapper around `saveImageFromRemoteUrl` for backwards compatibility.
 */
export async function savePersonProfileFromRemoteUrl(args: {
  personId: string;
  imageUrl: string;
}): Promise<SaveUploadResult> {
  return saveImageFromRemoteUrl({
    kind: "person",
    entityId: args.personId,
    imageUrl: args.imageUrl,
  });
}
