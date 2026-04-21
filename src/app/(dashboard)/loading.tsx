/** Shown while a dashboard route segment is loading (e.g. slow network navigation). */
export default function DashboardLoading() {
  return (
    <div
      className="-mx-6 -mb-6 min-h-0 min-w-0 animate-pulse"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="sticky top-0 z-30 min-w-0 max-w-full border-b border-zinc-800/70 bg-[var(--surface-toolbar)] px-6 pt-6 pb-3">
        <div className="h-8 w-40 rounded-md bg-zinc-800/90" />
      </div>
      <div className="h-5 shrink-0 border-b border-zinc-800/70 bg-[var(--surface-toolbar)]" />
      <div className="min-w-0 max-w-full px-6 pb-6 pt-0">
        <div className="mb-4 h-10 max-w-xl rounded-md bg-zinc-800/70" />
        <div className="mb-3 h-4 w-full max-w-2xl rounded bg-zinc-800/50" />
        <div className="space-y-3">
          <div className="h-28 rounded-lg border border-zinc-800/70 bg-zinc-900/50" />
          <div className="h-28 rounded-lg border border-zinc-800/70 bg-zinc-900/50" />
          <div className="h-28 rounded-lg border border-zinc-800/70 bg-zinc-900/50" />
        </div>
      </div>
    </div>
  );
}
