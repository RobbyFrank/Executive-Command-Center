/**
 * Followups page loading skeleton.
 *
 * Mirrors the rendered layout of `UnrepliedAsksView` so the transition to the
 * real UI is seamless. Shape:
 *   - Sticky top bar (56px, horizontal): title + tagline + sort + refresh+scan-age compound control.
 *   - Collapsed group cards (not expanded rows) since the wall defaults to all-collapsed.
 *
 * Placeholders are zinc-800 with a subtle shimmer. Sized / spaced to match
 * the real components (avatar 28×28, `py-2.5 pl-4 pr-4`, rounded-xl cards, etc.)
 * so there's no layout jump when the server data arrives.
 */
export default function UnrepliedLoading() {
  return (
    <div
      className="pb-10 motion-safe:animate-[unrepliedFade_0.3s_ease-out_both] motion-reduce:animate-none"
      aria-busy="true"
      aria-label="Loading Followups"
    >
      {/* Sticky top bar — mirrors `h-14 max-w-4xl` layout in UnrepliedAsksView. */}
      <div className="sticky top-0 z-30 -mx-6 mb-6 border-b border-zinc-800/80 bg-zinc-950/90 px-6 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-3">
          {/* Title block: icon + "Followups". */}
          <div className="flex shrink-0 items-center gap-2">
            <div className="h-4 w-4 rounded bg-zinc-800/90" />
            <div className="h-4 w-20 rounded bg-zinc-800/90" />
          </div>
          {/* Tagline — hidden below lg, mirrors real tagline. */}
          <div className="hidden min-w-0 flex-1 lg:block">
            <div className="h-3 w-72 max-w-full rounded bg-zinc-800/60" />
          </div>
          {/* Sort + Refresh control with embedded scan age (mirrors `UnrepliedAsksView`). */}
          <div className="ml-auto flex h-8 shrink-0 items-center gap-2 sm:ml-2">
            <div className="h-8 w-32 rounded-md bg-zinc-800/80" />
            <div className="flex h-8 overflow-hidden rounded-md border border-zinc-700/80">
              <div className="h-full w-24 bg-zinc-800/80" />
              <div className="hidden h-full w-12 border-l border-zinc-700/60 bg-zinc-800/50 md:block" />
            </div>
          </div>
        </div>
      </div>

      {/* Group list — mirrors collapsed groups (the default view). */}
      <div className="mx-auto max-w-4xl">
        <div className="space-y-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="overflow-visible rounded-xl border border-zinc-800 bg-zinc-900/35 motion-safe:animate-[unrepliedFade_0.35s_ease-out_both] motion-reduce:animate-none"
              style={{
                animationDelay: `${i * 60}ms`,
                animationFillMode: "backwards",
              }}
            >
              {/* Collapsed group header — matches the real `<button>` shape. */}
              <div className="flex items-center gap-2.5 py-2.5 pl-4 pr-4">
                {/* Avatar (28×28 rounded-full) — matches `<Avatar size="md">`. */}
                <div className="h-7 w-7 shrink-0 rounded-full bg-zinc-800/80 ring-1 ring-zinc-700/70" />
                {/* Assignee name — width varies a bit per row for natural feel. */}
                <div
                  className="h-4 rounded bg-gradient-to-r from-zinc-800 via-zinc-700/85 to-zinc-800 bg-[length:200%_100%] motion-safe:animate-[unrepliedShimmer_1.15s_ease-in-out_infinite] motion-reduce:animate-none"
                  style={{
                    width: [120, 96, 140, 108, 156][i % 5],
                    animationDelay: `${i * 90}ms`,
                  }}
                />
                {/* Count pill — small rounded-full placeholder. */}
                <div className="h-5 w-7 shrink-0 rounded-full border border-zinc-700/80 bg-zinc-800/60" />
                {/* Chevron slot — pushed to the right. */}
                <div className="ml-auto h-4 w-4 shrink-0 rounded bg-zinc-800/70" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
