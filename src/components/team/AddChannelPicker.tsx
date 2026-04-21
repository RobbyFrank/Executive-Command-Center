"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Hash, Loader2, Plus, Sparkles } from "lucide-react";
import type { SlackChannel } from "@/lib/slack";
import { fetchSlackChannelsList } from "@/server/actions/slack";
import {
  getFreshSlackChannelsListCache,
  putSlackChannelsListCache,
} from "@/lib/slackChannelsListClientCache";
import { SlackLogo } from "@/components/tracker/SlackLogo";
import { cn } from "@/lib/utils";

interface AddChannelPickerProps {
  /** Channel ids currently selected elsewhere (hidden from the list so the user can't re-add). */
  selectedChannelIds: ReadonlySet<string>;
  /** Called once per chosen channel. */
  onPick: (channel: SlackChannel) => void;
  /** Extra action row rendered at the top (e.g. "Create new private channel…"). */
  onCreateNew?: () => void;
  /** Button label (default: "Add channel…"). */
  label?: string;
  /** Panel width (default 380). */
  panelWidth?: number;
  /** Panel height (default 400). */
  maxHeight?: number;
}

/**
 * Trigger + panel picker that lists every workspace Slack channel and calls `onPick` for
 * the one chosen. Adapter over the same fetch + cache helpers used by
 * `SlackChannelPicker` on Roadmap so the recommender stays consistent with that element
 * without coupling to the chip/pencil presentation.
 *
 * Unlike `SlackChannelPicker`, this component:
 * - Has no current-value chip (purely additive).
 * - Hides already-selected channels so the list naturally shrinks as picks accumulate.
 * - Optionally renders a "Create new private channel…" action at the top.
 */
export function AddChannelPicker({
  selectedChannelIds,
  onPick,
  onCreateNew,
  label = "Add channel…",
  panelWidth = 380,
  maxHeight = 400,
}: AddChannelPickerProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [scopeNotice, setScopeNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const anchorRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setFetchError(null);

    const cached = getFreshSlackChannelsListCache();
    if (cached) {
      setChannels(cached.channels);
      setScopeNotice(cached.notice);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setScopeNotice(null);

    void (async () => {
      const r = await fetchSlackChannelsList();
      if (cancelled) return;
      setLoading(false);
      if (r.ok) {
        setChannels(r.channels);
        setScopeNotice(r.notice ?? null);
        putSlackChannelsListCache(r.channels, r.notice ?? null);
      } else {
        setFetchError(r.error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const reposition = useCallback(() => {
    if (!open || !anchorRef.current) {
      setPos(null);
      return;
    }
    const rect = anchorRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    const width = Math.min(panelWidth, vw - margin * 2);
    let left = rect.left;
    left = Math.max(margin, Math.min(left, vw - width - margin));
    let top = rect.bottom + 4;
    if (top + maxHeight > vh) top = Math.max(margin, rect.top - maxHeight - 4);
    setPos({ top, left });
  }, [open, panelWidth, maxHeight]);

  useLayoutEffect(() => {
    reposition();
    if (open) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [reposition, open]);

  useLayoutEffect(() => {
    if (!open) return;
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition]);

  const close = useCallback(() => {
    setOpen(false);
    setSearch("");
  }, []);

  const select = useCallback(
    (ch: SlackChannel) => {
      onPick(ch);
      close();
    },
    [onPick, close]
  );

  const filtered = useMemo(() => {
    const hiddenIds = selectedChannelIds;
    const remaining = channels.filter((c) => !hiddenIds.has(c.id));
    const q = search.trim().toLowerCase();
    if (!q) return remaining.slice(0, 500);
    return remaining
      .filter(
        (ch) =>
          ch.name.toLowerCase().includes(q) ||
          ch.topic.toLowerCase().includes(q) ||
          ch.purpose.toLowerCase().includes(q)
      )
      .slice(0, 500);
  }, [channels, selectedChannelIds, search]);

  return (
    <div className="min-w-0" onClick={(e) => e.stopPropagation()}>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200",
          "hover:border-zinc-600 hover:bg-zinc-800",
          open && "border-zinc-500 bg-zinc-800"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Plus className="h-3 w-3" aria-hidden />
        <span>{label}</span>
        <ChevronDown className="h-3 w-3 opacity-70" aria-hidden />
      </button>

      {mounted && open
        ? createPortal(
            <>
              <div
                className="fixed inset-0 z-[220]"
                aria-hidden
                onClick={close}
              />
              {pos ? (
                <div
                  className="fixed z-[230] flex flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
                  style={{
                    top: pos.top,
                    left: pos.left,
                    width: panelWidth,
                    maxHeight,
                  }}
                  role="listbox"
                  aria-label="Add Slack channel"
                >
                  <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
                    <SlackLogo className="h-4 w-4 shrink-0 opacity-80" />
                    <input
                      ref={searchRef}
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search public and private channels…"
                      className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                      disabled={loading || !!fetchError}
                    />
                  </div>

                  {scopeNotice && !fetchError ? (
                    <p
                      className="border-b border-amber-900/40 bg-amber-950/35 px-3 py-2 text-[11px] leading-snug text-amber-200/95"
                      role="status"
                    >
                      {scopeNotice}
                    </p>
                  ) : null}

                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                    {onCreateNew ? (
                      <button
                        type="button"
                        onClick={() => {
                          close();
                          onCreateNew();
                        }}
                        className="flex w-full cursor-pointer items-center gap-3 border-b border-zinc-800/80 bg-emerald-950/15 px-3 py-2 text-left text-sm text-emerald-200 transition-colors hover:bg-emerald-900/30"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-900/50 ring-1 ring-emerald-500/30">
                          <Sparkles className="h-3.5 w-3.5" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            Create new private channel…
                          </span>
                          <span className="block text-[11px] text-emerald-300/70">
                            Slack conversations.create (private) — you become the creator.
                          </span>
                        </span>
                      </button>
                    ) : null}

                    {loading ? (
                      <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-zinc-500">
                        <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
                        Loading channels…
                      </div>
                    ) : fetchError ? (
                      <p className="px-3 py-6 text-sm leading-relaxed text-red-400/95">
                        {fetchError}
                      </p>
                    ) : filtered.length === 0 ? (
                      <p className="px-3 py-6 text-center text-sm text-zinc-500">
                        {channels.length === 0
                          ? "No channels returned from Slack."
                          : "No channels match your search."}
                      </p>
                    ) : (
                      filtered.map((ch) => (
                        <button
                          key={ch.id}
                          type="button"
                          onClick={() => select(ch)}
                          className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-800"
                          role="option"
                          aria-selected={false}
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700">
                            <Hash className="h-3.5 w-3.5" aria-hidden />
                          </span>
                          <div className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate font-medium text-zinc-100">
                                {ch.name}
                              </span>
                              {ch.isPrivate ? (
                                <span className="shrink-0 rounded bg-zinc-800 px-1 py-px text-[10px] text-zinc-400">
                                  Private
                                </span>
                              ) : null}
                            </span>
                            {(ch.purpose || ch.topic) && (
                              <p className="truncate text-[11px] leading-tight text-zinc-500">
                                {ch.purpose || ch.topic}
                              </p>
                            )}
                          </div>
                          {ch.memberCount >= 0 && (
                            <span className="shrink-0 tabular-nums text-[10px] text-zinc-600">
                              {ch.memberCount}
                            </span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </>,
            document.body
          )
        : null}
    </div>
  );
}
