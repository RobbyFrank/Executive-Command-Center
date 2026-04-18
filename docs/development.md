# Development

## Stale Next.js / Turbopack cache

If TypeScript or the dev server reports missing modules under paths that no longer exist (for example generated `.next/types/` entries pointing at deleted `app/` routes):

1. Stop the dev server.
2. Delete the **`.next`** directory.
3. Start again with `npm run dev`.

The `.next` folder is gitignored and safe to remove; it will be recreated.

## See also

- [operations.md](operations.md) — CI, lint, typecheck
