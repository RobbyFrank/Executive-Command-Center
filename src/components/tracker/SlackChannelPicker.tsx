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
import { ChevronDown, Hash, Loader2, Plus, X } from "lucide-react";
import type { SlackChannel } from "@/lib/slack";
import {
  channelMatchesCompanyTerms,
  companyFilterTerms,
} from "@/lib/scrapeCompanyChannels";
import {
  getFreshSlackChannelsListCache,
  putSlackChannelsListCache,
} from "@/lib/slackChannelsListClientCache";
import { fetchSlackChannelsList } from "@/server/actions/slack";
import { formatSlackChannelHash, slackChannelUrl } from "@/lib/slackDisplay";
import { SlackLogo } from "./SlackLogo";
import { cn } from "@/lib/utils";

interface SlackChannelPickerProps {
  channelName: string;
  channelId: string;
  onSave: (channel: { name: string; id: string }) => void;
  /** Company display name — used with `companyShortName` for optional “relevant only” pre-filter. */
  companyName?: string;
  /** Company short label (e.g. VD) — case-insensitive match in channel name/topic/purpose. */
  companyShortName?: string;
  /** Roadmap grid alignment. */
  trackerGridAlign?: boolean;
  /** "plain" variant omits pill background on the resting label. */
  variant?: "default" | "plain";
}

const PANEL_W = 380;

export function SlackChannelPicker({
  channelName,
  channelId,
  onSave,
  companyName,
  companyShortName,
  trackerGridAlign = false,
  variant = "default",
}: SlackChannelPickerProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [scopeNotice, setScopeNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  /** When true, narrow the list to channels matching company name / short name (default each open). */
  const [relevantOnly, setRelevantOnly] = useState(true);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setRelevantOnly(true);
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
        const notice = r.notice ?? null;
        setChannels(r.channels);
        setScopeNotice(notice);
        putSlackChannelsListCache(r.channels, notice);
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
    const width = Math.min(PANEL_W, vw - margin * 2);
    let left = rect.left;
    left = Math.max(margin, Math.min(left, vw - width - margin));
    let top = rect.bottom + 4;
    if (top + 400 > vh) top = Math.max(margin, rect.top - 400 - 4);
    setPos({ top, left });
  }, [open]);

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

  const companyTerms = useMemo(
    () => companyFilterTerms(companyName, companyShortName),
    [companyName, companyShortName]
  );
  const hasCompanyFilter = companyTerms.length > 0;

  const select = useCallback(
    (ch: SlackChannel) => {
      onSave({ name: ch.name, id: ch.id });
      close();
    },
    [onSave, close],
  );

  const clear = useCallback(() => {
    onSave({ name: "", id: "" });
    close();
  }, [onSave, close]);

  const companyScoped = useMemo(() => {
    if (!relevantOnly || !hasCompanyFilter) return channels;
    return channels.filter((ch) => channelMatchesCompanyTerms(ch, companyTerms));
  }, [channels, relevantOnly, hasCompanyFilter, companyTerms]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companyScoped;
    return companyScoped.filter(
      (ch) =>
        ch.name.toLowerCase().includes(q) ||
        ch.topic.toLowerCase().includes(q) ||
        ch.purpose.toLowerCase().includes(q),
    );
  }, [companyScoped, search]);

  const hasChannel = channelName.trim() || channelId.trim();
  const displayHash = hasChannel ? formatSlackChannelHash(channelName || channelId) : "";
  const linkUrl = channelId.trim() ? slackChannelUrl(channelId) : "";

  /** Roadmap goal row: match project Due date / Status (`text-xs font-medium leading-tight`). */
  const channelLabelClasses = cn(
    "flex min-w-0 flex-1 items-center rounded py-0.5 text-left transition-colors",
    trackerGridAlign
      ? "pl-0 text-xs font-medium leading-tight text-zinc-300"
      : "min-h-[24px] pl-1.5 text-sm text-zinc-300",
    variant === "plain" && "hover:bg-zinc-800/60",
  );

  const collapsed = (
    <div className="group/channel flex w-full min-w-0 items-center gap-0.5">
      {hasChannel ? (
        <>
          {linkUrl ? (
            <a
              href={linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={cn(
                channelLabelClasses,
                "cursor-pointer hover:bg-zinc-800",
                variant === "plain" && "hover:bg-zinc-800/60",
              )}
              title={`Open ${displayHash} in Slack`}
            >
              <span className="min-w-0 truncate">{displayHash}</span>
            </a>
          ) : (
            <span
              className={cn(channelLabelClasses, "cursor-default")}
              title={`Slack channel: ${displayHash}`}
            >
              <span className="min-w-0 truncate">{displayHash}</span>
            </span>
          )}
          <button
            ref={anchorRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(!open);
            }}
            className="flex shrink-0 items-center rounded p-0.5 text-zinc-500 opacity-0 transition-[opacity,colors] group-hover/channel:opacity-100 hover:bg-zinc-800 hover:text-zinc-300"
            title="Change Slack channel"
            aria-expanded={open}
            aria-haspopup="listbox"
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </button>
        </>
      ) : (
        <button
          ref={anchorRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
          className={cn(
            "group/slack flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-zinc-700/60 bg-transparent text-zinc-600 transition-colors hover:bg-zinc-900/80 hover:text-zinc-300",
          )}
          title="Click to set Slack channel"
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          <span className="relative inline-flex h-4 w-4 items-center justify-center" aria-hidden>
            <Hash className="h-3.5 w-3.5" />
            <Plus className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5" />
          </span>
        </button>
      )}
    </div>
  );

  const overlay =
    mounted && open ? (
      <>
        <div
          className="fixed inset-0 z-[100]"
          aria-hidden
          onClick={close}
        />
        {pos && (
          <div
            className="fixed z-[110] flex max-h-[400px] flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
            style={{ top: pos.top, left: pos.left, width: PANEL_W }}
            role="listbox"
            aria-label="Choose Slack channel"
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
              {hasChannel && (
                <button
                  type="button"
                  onClick={clear}
                  className="shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                  title="Remove channel"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {hasCompanyFilter ? (
              <label className="flex cursor-pointer items-center gap-2 border-b border-zinc-800/90 px-3 py-2 text-[11px] text-zinc-400 hover:bg-zinc-800/30">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 shrink-0 rounded border-zinc-600 bg-zinc-950 text-violet-500 focus:ring-violet-500/40"
                  checked={relevantOnly}
                  onChange={(e) => setRelevantOnly(e.target.checked)}
                  disabled={loading || !!fetchError}
                />
                <span className="min-w-0 leading-snug">
                  Relevant only
                  <span className="block text-[10px] text-zinc-600">
                    Match company name or short name in channel name, topic, or purpose
                  </span>
                </span>
              </label>
            ) : null}

            {scopeNotice && !fetchError && (
              <p
                className="border-b border-amber-900/40 bg-amber-950/35 px-3 py-2 text-[11px] leading-snug text-amber-200/95"
                role="status"
              >
                {scopeNotice}
              </p>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
                    : relevantOnly &&
                        hasCompanyFilter &&
                        companyScoped.length === 0
                      ? "No channels match this company. Turn off “Relevant only” to see the full list."
                      : "No channels match your search."}
                </p>
              ) : (
                filtered.map((ch) => {
                  const selected = ch.id === channelId;
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => select(ch)}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-800",
                        selected && "bg-zinc-800/60",
                      )}
                      role="option"
                      aria-selected={selected}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700">
                        <Hash className="h-3.5 w-3.5" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium text-zinc-100">
                            {ch.name}
                          </span>
                        </div>
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
                  );
                })
              )}
            </div>
          </div>
        )}
      </>
    ) : null;

  return (
    <div className="w-full min-w-0" onClick={(e) => e.stopPropagation()}>
      {collapsed}
      {mounted && overlay ? createPortal(overlay, document.body) : null}
    </div>
  );
}
