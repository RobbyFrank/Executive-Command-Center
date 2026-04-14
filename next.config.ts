import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Directory containing this config file — stable app root for Turbopack (see `turbopack.root`). */
const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const localNodeModules = path.join(projectRoot, "node_modules");

const nextConfig: NextConfig = {
  // When another lockfile exists higher on the drive (e.g. `C:\Users\<you>\package-lock.json`),
  // Next may infer the wrong workspace root and fail to resolve `@/` and `src/`. Pin the app root.
  //
  // If a `package.json` in your user folder lists `./Cursor Projects` (or similar), enhanced-resolve
  // may try to resolve bare imports like `tailwindcss` from `...\Cursor Projects` (no node_modules
  // there). Aliasing forces deps to this app's install.
  turbopack: {
    root: projectRoot,
    resolveAlias: {
      tailwindcss: path.join(localNodeModules, "tailwindcss"),
      "@tailwindcss/postcss": path.join(localNodeModules, "@tailwindcss/postcss"),
    },
  },
  serverExternalPackages: ["bcryptjs"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
