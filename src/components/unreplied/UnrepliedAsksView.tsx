"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  Clock,
  EyeOff,
  Hash,
  Loader2,
  MessageSquare,
  MessageSquareWarning,
  RefreshCw,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { QuickReplyPopover } from "./QuickReplyPopover";
import { SlackMentionInlineText } from "@/components/tracker/SlackMentionInlineText";
import { displayInitials } from "@/lib/displayInitials";
import { slackChannelUrl } from "@/lib/slackDisplay";
import { entrySlackMessageDate } from "@/lib/unrepliedAsksFilters";
import type { UnrepliedScanProgressEvent } from "@/lib/unrepliedAsksScanTypes";
import {
  applyScanProgressEvent,
  initialScanPanelState,
  openScanPanel,
} from "@/lib/unrepliedAsksScanApply";
import type { Person } from "@/lib/types/tracker";
import type { UnrepliedAsksSnapshot } from "@/server/actions/unrepliedAsks";
import { importSlackMemberByUserId } from "@/server/actions/slack";
import {
  dismissUnrepliedAsk,
  markUnrepliedAskNudged,
  snoozeUnrepliedAsk,
} from "@/server/actions/unrepliedAsks";
import { cn } from "@/lib/utils";
import { FollowupThreadPopover } from "./FollowupThreadPopover";
import { SlackReactionsRow } from "./SlackReactionsRow";
import { UnrepliedScanProgressPanel } from "./UnrepliedScanProgressPanel";

type Props = {
  snapshot: UnrepliedAsksSnapshot;
  people: Person[];
};

type GroupRow = UnrepliedAsksSnapshot["rows"][number];
type GroupAssignee = GroupRow["assignees"][number];

type Group = {
  key: string;
  /** Concatenated assignee names (e.g. "Dave" or "Dave & James"), or "Unknown assignee". */
  label: string;
  /**
   * Resolved assignees for this group, most-recent first. Empty when the
   * thread + classifier both came up blank (the classic "Unknown assignee"
   * bucket). Used to render avatars + names in the header and to power the
   * per-person "Add to Team" CTAs.
   */
  assignees: GroupAssignee[];
  rows: GroupRow[];
};

/** Composite group key from an ordered list of uppercase Slack user ids. */
function groupKeyFromAssignees(assignees: GroupAssignee[]): string {
  if (assignees.length === 0) return "__none__";
  // Sort so `[Dave, James]` and `[James, Dave]` share a bucket even if one ask
  // happened to list them in a different order — same set of people = same group.
  return [...assignees.map((a) => a.slackUserId)].sort().join("|");
}

/** Joins assignee names for the group header: "Dave", "Dave & James", "Dave, James & Priya". */
function joinAssigneeLabels(assignees: GroupAssignee[]): string {
  if (assignees.length === 0) return "Unknown assignee";
  if (assignees.length === 1) return assignees[0]!.name;
  if (assignees.length === 2) return `${assignees[0]!.name} & ${assignees[1]!.name}`;
  const last = assignees[assignees.length - 1]!.name;
  const head = assignees.slice(0, -1).map((a) => a.name).join(", ");
  return `${head} & ${last}`;
}

type SortMode = "count" | "name";

const FOLLOWUPS_SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "count", label: "Most messages" },
  { value: "name", label: "Name (A–Z)" },
];

function FollowupsSortSelect({
  value,
  onChange,
}: {
  value: SortMode;
  onChange: (v: SortMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const current =
    FOLLOWUPS_SORT_OPTIONS.find((o) => o.value === value) ??
    FOLLOWUPS_SORT_OPTIONS[0]!;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const pick = useCallback(
    (mode: SortMode) => {
      onChange(mode);
      setOpen(false);
    },
    [onChange]
  );

  return (
    <div className="relative inline-flex max-w-full shrink-0">
      <span id={`${listId}-label`} className="sr-only">
        Sort followups by
      </span>
      <button
        type="button"
        aria-labelledby={`${listId}-label`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={`${listId}-listbox`}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-8 w-max min-w-0 max-w-full items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900/70 px-2.5 text-left text-[11px] font-medium text-zinc-300",
          "transition-[border-color,box-shadow,background-color] duration-150 ease-out motion-reduce:transition-none",
          "hover:border-zinc-600 hover:bg-zinc-900/90",
          "focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400/25 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
          open &&
            "border-zinc-500/50 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
        )}
      >
        <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
        <span className="shrink-0 text-zinc-500">Sort</span>
        <span className="min-w-0 shrink truncate font-semibold text-zinc-100">
          {current.label}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform motion-reduce:transition-none",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-40"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div
            id={`${listId}-listbox`}
            role="listbox"
            aria-labelledby={`${listId}-label`}
            className="absolute left-0 top-full z-50 mt-1 min-w-full rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg shadow-black/40 ring-1 ring-white/5"
          >
            {FOLLOWUPS_SORT_OPTIONS.map((opt) => {
              const selected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => pick(opt.value)}
                  className={cn(
                    "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] transition-colors",
                    selected
                      ? "bg-zinc-800/95 text-zinc-50"
                      : "text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100"
                  )}
                >
                  <span className="min-w-0 flex-1">{opt.label}</span>
                  {selected ? (
                    <Check
                      className="h-3 w-3 shrink-0 text-emerald-500/90"
                      strokeWidth={2.5}
                      aria-hidden
                    />
                  ) : (
                    <span className="w-3 shrink-0" aria-hidden />
                  )}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Sticky offset (px) below the page-level header so group headers don't hide behind it. */
const STICKY_TOP_PX = 56;

function formatScanTime(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function formatScanRelative(iso: string | null): string {
  if (!iso) return "Never scanned";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Never scanned";
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return "just now";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `Last scanned ${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `Last scanned ${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `Last scanned ${day}d ago`;
  return `Last scanned ${Math.floor(day / 7)}w ago`;
}

/** Compact age only (e.g. `50m ago`) — for UI next to "Refresh" where full "Last scanned …" is redundant. */
function formatScanAgeShort(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return "just now";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day}d ago`;
  return `${Math.floor(day / 7)}w ago`;
}

/** Relative post age for message rows (matches scan header: m → h → d → w; no fractional hours). */
function formatMessageAgeShort(sentAt: Date, now: Date): string {
  const diffMs = now.getTime() - sentAt.getTime();
  if (diffMs < 0) return "just now";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day}d ago`;
  return `${Math.floor(day / 7)}w ago`;
}

function FollowupsJumpRail({
  groups,
  openGroupKey,
  onJump,
}: {
  groups: Group[];
  openGroupKey: string | null;
  onJump: (key: string) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <aside
      className="pointer-events-none fixed right-3 top-1/2 z-20 hidden -translate-y-1/2 xl:block"
      aria-label="Jump to assignee"
    >
      <ul className="pointer-events-auto flex max-h-[78vh] flex-col gap-1.5 overflow-y-auto rounded-full border border-zinc-800/80 bg-zinc-950/80 p-2 shadow-lg shadow-black/40 ring-1 ring-white/5 backdrop-blur">
        {groups.map((g) => {
          const active = openGroupKey === g.key;
          return (
            <li key={g.key}>
              <button
                type="button"
                onClick={() => onJump(g.key)}
                aria-label={`Jump to ${g.label} (${g.rows.length} open)`}
                title={`${g.label} — ${g.rows.length}`}
                className={cn(
                  "group relative flex h-9 w-9 items-center justify-center rounded-full transition-transform duration-150",
                  "hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60",
                  active && "scale-105"
                )}
              >
                <Avatar
                  src={g.assignees[0]?.profilePicturePath}
                  name={g.label}
                  size="md"
                  className={cn(
                    "h-8 w-8 ring-2 transition-colors duration-150",
                    active
                      ? "ring-violet-400/90"
                      : "ring-zinc-700/70 group-hover:ring-zinc-500"
                  )}
                />
                <span
                  className={cn(
                    "pointer-events-none absolute -bottom-1 -right-1 min-w-[18px] rounded-full border border-zinc-950 px-1 text-center text-[10px] font-bold leading-[16px] tabular-nums",
                    active
                      ? "bg-violet-500 text-white"
                      : "bg-zinc-800 text-zinc-200"
                  )}
                >
                  {g.rows.length > 99 ? "99+" : g.rows.length}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

/**
 * Compact inline actions (icon + short label) on the same line as the
 * metadata. Tone is applied by the caller.
 */
const ROW_MESSAGE_ACTION =
  "inline-flex h-6 min-w-0 shrink-0 items-center justify-center gap-0.5 rounded-md border px-1.5 text-[9px] font-medium leading-none text-zinc-200 transition-[transform,background-color,border-color,color,opacity] duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 sm:gap-1 sm:px-2 sm:text-[10px] [&>svg]:h-2.5 [&>svg]:w-2.5 sm:[&>svg]:h-3 sm:[&>svg]:w-3";

/** Muted "at rest" look; `group/row` lives on the message cell — hover = full focus. */
const ROW_ACTION_MUTED_NEUTRAL =
  "border-zinc-800/20 bg-zinc-950/25 text-zinc-500/55 shadow-none";
const ROW_ACTION_LIFT_NEUTRAL =
  "group-hover/row:border-zinc-600/50 group-hover/row:bg-zinc-800/50 group-hover/row:text-zinc-200 group-focus-within/row:border-zinc-600/50 group-focus-within/row:bg-zinc-800/50 group-focus-within/row:text-zinc-200";
/** On coarse / small viewports, actions stay tappable (no reliable hover). */
const ROW_ACTION_COARSE_LIFT = "max-sm:border-zinc-600/50 max-sm:bg-zinc-800/50 max-sm:text-zinc-200";
const ROW_ACTION_MUTED_VIOLET =
  "border-violet-500/10 bg-violet-950/20 text-violet-200/40 shadow-none";
const ROW_ACTION_LIFT_VIOLET =
  "group-hover/row:border-violet-500/50 group-hover/row:bg-violet-900/50 group-hover/row:text-violet-100 group-focus-within/row:border-violet-500/50 group-focus-within/row:bg-violet-900/50 group-focus-within/row:text-violet-100";
const ROW_ACTION_COARSE_LIFT_VIOLET =
  "max-sm:border-violet-500/50 max-sm:bg-violet-900/50 max-sm:text-violet-100";

/**
 * Opens a compact read-only preview of the Slack thread anchored to this
 * button (top-right icon cluster on the message row).
 */
function ThreadPreviewButton({
  slackUrl,
  rosterHints,
  people,
  focusTs,
}: {
  slackUrl: string;
  rosterHints: UnrepliedAsksSnapshot["rosterHints"];
  people: Person[];
  /** Slack ts of the ask for this row — highlighted inside the thread preview. */
  focusTs?: string;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Preview Slack thread"
        title="Preview thread"
        className={cn(
          ROW_MESSAGE_ACTION,
          "focus-visible:ring-zinc-500/60",
          open
            ? "border-zinc-500 bg-zinc-800 text-zinc-100"
            : cn(
                ROW_ACTION_MUTED_NEUTRAL,
                ROW_ACTION_LIFT_NEUTRAL,
                ROW_ACTION_COARSE_LIFT
              )
        )}
      >
        <MessageSquare aria-hidden />
        <span className="whitespace-nowrap">Thread</span>
      </button>
      <FollowupThreadPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        slackUrl={slackUrl}
        rosterHints={rosterHints}
        people={people}
        focusTs={focusTs}
      />
    </>
  );
}

/**
 * One-click AI "Quick reply" affordance on a Followups row. Opens a compact
 * popover anchored to the button that auto-drafts a context-grounded reply
 * with AI and lets the user post (or revise) in place. The heavy
 * `SlackPingDialog` is intentionally *not* used here — this is meant to be
 * a fast, low-friction acknowledgment flow.
 */
function QuickReplyButton({
  slackUrl,
  rosterHints,
  people,
  assigneeName,
  onSent,
}: {
  slackUrl: string;
  rosterHints: UnrepliedAsksSnapshot["rosterHints"];
  people: Person[];
  assigneeName: string | null;
  onSent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Draft a quick AI reply"
        title="Quick reply — AI drafts a short reply grounded in the thread"
        className={cn(
          ROW_MESSAGE_ACTION,
          "focus-visible:ring-violet-500/70",
          open
            ? "border-violet-400 bg-violet-800/80 text-violet-50"
            : cn(
                ROW_ACTION_MUTED_VIOLET,
                ROW_ACTION_LIFT_VIOLET,
                ROW_ACTION_COARSE_LIFT_VIOLET
              )
        )}
      >
        <Sparkles aria-hidden />
        <span className="whitespace-nowrap">Reply</span>
      </button>
      <QuickReplyPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        slackUrl={slackUrl}
        rosterHints={rosterHints}
        people={people}
        assigneeName={assigneeName}
        onSent={() => {
          setOpen(false);
          onSent();
        }}
      />
    </>
  );
}

const SNOOZE_DAY_OPTIONS = [1, 3, 7, 14, 30] as const;

function snoozeDayLabel(days: number): string {
  return `${days}d`;
}

/**
 * Snooze menu: pick 1–30 days (`snoozeUnrepliedAsk`). The row hides until
 * `snoozeUntil` passes; it re-surfaces on a later scan **only if still
 * unreplied** (reply state keeps updating regardless of snooze).
 */
function SnoozeButton({
  onSnooze,
  disabled,
}: {
  onSnooze: (days: number) => void | Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const pick = useCallback(
    (days: number) => {
      setOpen(false);
      void onSnooze(days);
    },
    [onSnooze]
  );

  return (
    <div className="relative inline-flex max-w-full shrink-0">
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        aria-label="Snooze — choose duration"
        title="Snooze — hide from Followups for a chosen number of days"
        className={cn(
          ROW_MESSAGE_ACTION,
          "focus-visible:ring-zinc-500/60",
          open
            ? "border-zinc-500 bg-zinc-800 text-zinc-100"
            : cn(
                ROW_ACTION_MUTED_NEUTRAL,
                ROW_ACTION_LIFT_NEUTRAL,
                ROW_ACTION_COARSE_LIFT
              )
        )}
      >
        <Clock aria-hidden />
        <span className="whitespace-nowrap">Snooze</span>
      </button>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-40"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div
            id={menuId}
            role="menu"
            aria-label="Snooze duration"
            className="absolute right-0 top-full z-50 mt-1 min-w-[7.5rem] rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg shadow-black/40 ring-1 ring-white/5"
          >
            {SNOOZE_DAY_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                role="menuitem"
                onClick={() => pick(days)}
                className="flex w-full items-center px-2.5 py-1.5 text-left text-[11px] text-zinc-200 transition-colors hover:bg-zinc-800/70 focus:bg-zinc-800/70 focus:outline-none"
              >
                {snoozeDayLabel(days)}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Dismiss an ask from the Followups wall (sets `state: dismissed`). */
function DismissButton({
  onDismiss,
  disabled,
}: {
  onDismiss: () => void | Promise<void>;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => void onDismiss()}
      disabled={disabled}
      aria-label="Dismiss this ask"
      title="Dismiss — hide from the Followups wall"
      className={cn(
        ROW_MESSAGE_ACTION,
        "focus-visible:ring-zinc-500/60",
        ROW_ACTION_MUTED_NEUTRAL,
        ROW_ACTION_LIFT_NEUTRAL,
        ROW_ACTION_COARSE_LIFT
      )}
    >
      <EyeOff aria-hidden />
      <span className="whitespace-nowrap">Hide</span>
    </button>
  );
}

/**
 * Overlapping avatar stack for a group header (shows every effective assignee).
 * Falls back to the single-avatar layout for one-person groups.
 */
function AssigneeAvatarStack({
  assignees,
  fallbackLabel,
}: {
  assignees: GroupAssignee[];
  fallbackLabel: string;
}) {
  if (assignees.length === 0) {
    return <Avatar src={undefined} name={fallbackLabel} size="md" />;
  }
  if (assignees.length === 1) {
    const a = assignees[0]!;
    return <Avatar src={a.profilePicturePath} name={a.name} size="md" />;
  }
  // Stack at most 3 avatars; if more, overflow into a "+N" chip.
  const visible = assignees.slice(0, 3);
  const extra = assignees.length - visible.length;
  return (
    <span
      className="inline-flex shrink-0 items-center -space-x-2"
      aria-hidden
    >
      {visible.map((a) => (
        <Avatar
          key={a.slackUserId}
          src={a.profilePicturePath}
          name={a.name}
          size="md"
          className="h-7 w-7 ring-2 ring-zinc-900"
        />
      ))}
      {extra > 0 ? (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-bold text-zinc-200 ring-2 ring-zinc-900">
          +{extra}
        </span>
      ) : null}
    </span>
  );
}

function Avatar({
  src,
  name,
  size,
  className,
}: {
  src?: string | null;
  name: string;
  size: "sm" | "md";
  className?: string;
}) {
  const dim =
    size === "md"
      ? "h-7 w-7 text-[10px]"
      : "h-5 w-5 text-[9px]";
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt=""
        className={cn(
          "shrink-0 rounded-full object-cover ring-1 ring-zinc-700/70",
          dim,
          className
        )}
      />
    );
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-zinc-800 font-semibold text-zinc-300 ring-1 ring-zinc-700/70",
        dim,
        className
      )}
      aria-hidden
    >
      {displayInitials(name)}
    </span>
  );
}

export function UnrepliedAsksView({ snapshot, people }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [refreshing, setRefreshing] = useState(false);
  /** Accordion: only one group open at a time. `null` = all collapsed (default). */
  const [openGroupKey, setOpenGroupKey] = useState<string | null>(null);
  const groupRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [importingAssigneeId, setImportingAssigneeId] = useState<string | null>(
    null
  );
  const [scanPanel, setScanPanel] = useState(initialScanPanelState);
  const [sortMode, setSortMode] = useState<SortMode>("count");

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const row of snapshot.rows) {
      const key = groupKeyFromAssignees(row.assignees);
      const existing = map.get(key);
      if (existing) {
        existing.rows.push(row);
        continue;
      }
      map.set(key, {
        key,
        label: joinAssigneeLabels(row.assignees),
        assignees: row.assignees,
        rows: [row],
      });
    }
    const out = [...map.values()];
    out.sort((a, b) => {
      if (a.key === "__none__") return 1;
      if (b.key === "__none__") return -1;
      if (sortMode === "count") {
        if (b.rows.length !== a.rows.length) {
          return b.rows.length - a.rows.length;
        }
        return a.label.localeCompare(b.label, undefined, {
          sensitivity: "base",
        });
      }
      return a.label.localeCompare(b.label, undefined, {
        sensitivity: "base",
      });
    });
    return out;
  }, [snapshot.rows, sortMode]);

  /**
   * Scroll the group's header just below the sticky app bar. We offset by
   * STICKY_TOP_PX so it docks right under the header instead of under it.
   * Using the `<main>` scroll container (closest `overflow-auto` ancestor).
   */
  const scrollGroupIntoView = useCallback((key: string) => {
    const el = groupRefs.current.get(key);
    if (!el) return;
    const scroller = el.closest("main") ?? document.scrollingElement ?? document.documentElement;
    if (!scroller) return;
    const rect = el.getBoundingClientRect();
    const scrollerRect = (scroller as HTMLElement).getBoundingClientRect();
    const currentTop = (scroller as HTMLElement).scrollTop;
    const target = currentTop + rect.top - scrollerRect.top - STICKY_TOP_PX - 4;
    (scroller as HTMLElement).scrollTo({ top: target, behavior: "smooth" });
  }, []);

  const toggleGroup = useCallback(
    (key: string) => {
      setOpenGroupKey((prev) => {
        const next = prev === key ? null : key;
        if (next) {
          // Wait one frame so the previously-open group starts collapsing
          // before we measure + scroll; avoids a jump if the closing group
          // was above the clicked one.
          requestAnimationFrame(() => scrollGroupIntoView(key));
        }
        return next;
      });
    },
    [scrollGroupIntoView]
  );

  const jumpToGroup = useCallback(
    (key: string) => {
      setOpenGroupKey(key);
      requestAnimationFrame(() => scrollGroupIntoView(key));
    },
    [scrollGroupIntoView]
  );

  const contentBusy = isPending;

  const onRefresh = async () => {
    let panelState = openScanPanel();
    setScanPanel(panelState);
    setRefreshing(true);

    try {
      const res = await fetch("/api/unreplied-asks/scan", {
        method: "POST",
        credentials: "same-origin",
      });

      if (res.status === 401) {
        toast.error("Sign in expired. Refresh the page and try again.");
        setScanPanel(initialScanPanelState);
        return;
      }

      if (res.status === 429) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(
          j.error ?? "Too many AI requests. Try again in a few moments."
        );
        setScanPanel(initialScanPanelState);
        return;
      }

      if (!res.ok) {
        toast.error("Could not start the Slack scan.");
        setScanPanel(initialScanPanelState);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setScanPanel(initialScanPanelState);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let sawComplete = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          let ev: UnrepliedScanProgressEvent;
          try {
            ev = JSON.parse(t) as UnrepliedScanProgressEvent;
          } catch {
            continue;
          }
          if (!ev || typeof ev !== "object" || !("type" in ev)) continue;

          panelState = applyScanProgressEvent(panelState, ev);
          setScanPanel(panelState);

          if (ev.type === "error") {
            toast.error(ev.message);
          }
          if (ev.type === "complete") {
            sawComplete = true;
          }
        }
      }

      if (sawComplete && panelState.complete) {
        const errs = panelState.complete.threadErrors;
        const errSuffix =
          errs > 0 ? ` (${errs} thread error${errs === 1 ? "" : "s"})` : "";
        const message = `Scan complete: ${panelState.complete.newClassified} new messages, ${panelState.complete.threadRefreshes} threads refreshed${errSuffix}.`;
        if (errs > 0) {
          toast.warning(message);
        } else {
          toast.success(message);
        }
        startTransition(() => {
          router.refresh();
        });
        window.setTimeout(() => {
          setScanPanel(initialScanPanelState);
        }, 950);
      } else if (panelState.phase === "error") {
        window.setTimeout(() => {
          setScanPanel(initialScanPanelState);
        }, 2800);
      } else if (!sawComplete) {
        toast.error("Scan ended unexpectedly. Try again.");
        setScanPanel(initialScanPanelState);
      }
    } catch {
      toast.error("Network error while scanning.");
      setScanPanel(initialScanPanelState);
    } finally {
      setRefreshing(false);
    }
  };

  let rowIndex = 0;

  return (
    <div className="pb-10">
      <UnrepliedScanProgressPanel state={scanPanel} />
      <FollowupsJumpRail
        groups={groups}
        openGroupKey={openGroupKey}
        onJump={jumpToGroup}
      />

      <div className="sticky top-0 z-30 -mx-6 mb-6 border-b border-zinc-800/80 bg-zinc-950/90 px-6 backdrop-blur-md transition-[box-shadow] duration-300">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-3">
          <h1 className="flex shrink-0 items-center gap-2 text-sm font-semibold text-zinc-100">
            <MessageSquareWarning
              className="h-4 w-4 shrink-0 text-amber-400/90"
              aria-hidden
            />
            Followups
          </h1>
          <p className="hidden min-w-0 flex-1 truncate text-xs text-zinc-400 lg:block">
            <span className="mr-1.5 text-zinc-600">·</span>
            Open asks waiting on a teammate for 2+ business days.
          </p>
          <div className="ml-auto flex h-8 shrink-0 items-center gap-2 sm:ml-2">
            <FollowupsSortSelect value={sortMode} onChange={setSortMode} />
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={refreshing}
              title={`Fetch new Slack messages since the last scan. Last scan: ${formatScanTime(snapshot.lastScanAt)}`}
              aria-label={
                refreshing
                  ? "Refreshing Slack messages"
                  : `Refresh now. ${formatScanRelative(snapshot.lastScanAt)}`
              }
              className="inline-flex h-8 items-stretch overflow-hidden rounded-md border border-zinc-600 bg-zinc-900 text-[11px] font-medium text-zinc-200 transition-[transform,background-color,opacity] duration-200 hover:bg-zinc-800 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/50"
            >
              <span className="inline-flex items-center gap-1.5 px-2.5">
                {refreshing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                )}
                Refresh now
              </span>
              <span
                className="hidden items-center border-l border-zinc-700/60 bg-zinc-950/45 px-2 text-[10px] font-normal tabular-nums text-zinc-500 md:inline-flex"
                aria-hidden="true"
              >
                {formatScanAgeShort(snapshot.lastScanAt)}
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl">
      {isPending ? (
        <div
          className="mb-5 overflow-hidden rounded-lg border border-zinc-800/90 bg-zinc-900/50 px-4 py-3 motion-safe:animate-[unrepliedFade_0.35s_ease-out_both] motion-reduce:animate-none"
          aria-busy="true"
          aria-label="Updating list"
        >
          <div className="mb-2 h-2.5 w-40 rounded-md bg-gradient-to-r from-zinc-800 via-zinc-700/85 to-zinc-800 bg-[length:200%_100%] animate-[unrepliedShimmer_1.15s_ease-in-out_infinite] motion-reduce:animate-none" />
          <div className="space-y-2">
            <div className="h-2 w-full rounded bg-zinc-800/75" />
            <div className="h-2 w-[88%] rounded bg-zinc-800/65" />
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">Refreshing the wall…</p>
        </div>
      ) : null}

      <div
        className={cn(
          "transition-opacity duration-300 motion-reduce:transition-none",
          contentBusy && "pointer-events-none opacity-55"
        )}
      >
        {snapshot.rows.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-8 text-center text-sm text-zinc-400 motion-safe:animate-[unrepliedFade_0.45s_ease-out_both] motion-reduce:animate-none">
            No followups in this window. Run a scan to pull the latest from Slack.
          </p>
        ) : (
          <div className="space-y-4">
            {groups.map((g, gi) => {
              const open = openGroupKey === g.key;
              const count = g.rows.length;
              return (
                <section
                  key={g.key}
                  ref={(el) => {
                    if (el) groupRefs.current.set(g.key, el);
                    else groupRefs.current.delete(g.key);
                  }}
                  id={`followups-group-${g.key}`}
                  className="overflow-visible rounded-xl border border-zinc-800 bg-zinc-900/35 motion-safe:animate-[unrepliedFade_0.4s_ease-out_both] motion-reduce:animate-none motion-safe:transition-[box-shadow,border-color] motion-safe:duration-300 hover:border-zinc-700/90"
                  style={{
                    animationDelay: `${gi * 60}ms`,
                    animationFillMode: "backwards",
                  }}
                >
                  {(() => {
                    const offRoster = g.assignees.filter((a) => !a.onRoster);
                    const importKey = offRoster
                      .map((a) => a.slackUserId)
                      .sort()
                      .join("|");
                    const importing =
                      offRoster.length > 0 && importingAssigneeId === importKey;
                    return (
                      <div
                        className={cn(
                          "group/followupHeader sticky z-10 flex items-stretch gap-2 rounded-t-xl border-b border-zinc-800/80 bg-zinc-900/95 backdrop-blur-md",
                          !open && "rounded-b-xl border-b-0"
                        )}
                        style={{ top: STICKY_TOP_PX }}
                      >
                        <button
                          type="button"
                          onClick={() => toggleGroup(g.key)}
                          aria-expanded={open}
                          aria-controls={`followups-group-body-${g.key}`}
                          className={cn(
                            "group/groupHeader flex min-w-0 flex-1 items-center gap-2.5 py-2.5 pl-4 pr-2 text-left transition-colors duration-200 hover:bg-zinc-800/40"
                          )}
                        >
                          <AssigneeAvatarStack
                            assignees={g.assignees}
                            fallbackLabel={g.label}
                          />
                          <span className="flex min-w-0 flex-1 items-center gap-1.5">
                            <span className="truncate text-sm font-medium text-zinc-100">
                              {g.label}
                            </span>
                            <span
                              className="inline-flex shrink-0 items-center rounded-full border border-zinc-700/80 bg-zinc-800/60 px-1.5 text-[10px] font-semibold leading-[1.25rem] tabular-nums text-zinc-300"
                              title={`${count} open ${
                                count === 1 ? "followup" : "followups"
                              } right now`}
                              aria-label={`${count} open ${
                                count === 1 ? "followup" : "followups"
                              }`}
                            >
                              {count}
                            </span>
                          </span>
                        </button>
                        {offRoster.length > 0 ? (
                          <button
                            type="button"
                            disabled={importing}
                            title={
                              offRoster.length === 1
                                ? `Add ${offRoster[0]!.name} to Team (same as Import from Slack)`
                                : `Add ${offRoster.map((a) => a.name).join(", ")} to Team`
                            }
                            className="inline-flex shrink-0 items-center justify-center gap-1.5 self-center rounded-lg border border-emerald-600/60 bg-emerald-950/40 px-2.5 py-1.5 text-[11px] font-medium text-emerald-100 transition-[transform,background-color,opacity] duration-200 hover:bg-emerald-900/45 active:scale-[0.98] disabled:opacity-50"
                            onClick={async (e) => {
                              e.stopPropagation();
                              setImportingAssigneeId(importKey);
                              try {
                                const results = await Promise.all(
                                  offRoster.map((a) =>
                                    importSlackMemberByUserId(a.slackUserId)
                                  )
                                );
                                let imported = 0;
                                let already = 0;
                                for (const r of results) {
                                  if (!r.ok) {
                                    toast.error(r.error);
                                    continue;
                                  }
                                  if (
                                    "alreadyOnTeam" in r &&
                                    r.alreadyOnTeam
                                  ) {
                                    already += 1;
                                  } else if ("imported" in r) {
                                    imported += 1;
                                    toast.success(
                                      `Added ${r.imported.name} to Team.`,
                                      r.avatarWarning
                                        ? { description: r.avatarWarning }
                                        : undefined
                                    );
                                  }
                                }
                                if (already > 0 && imported === 0) {
                                  toast.info(
                                    already === 1
                                      ? "Already on the team."
                                      : `${already} people already on the team.`
                                  );
                                }
                                startTransition(() => {
                                  router.refresh();
                                });
                              } finally {
                                setImportingAssigneeId(null);
                              }
                            }}
                          >
                            {importing ? (
                              <Loader2
                                className="h-3.5 w-3.5 shrink-0 animate-spin"
                                aria-hidden
                              />
                            ) : (
                              <UserPlus
                                className="h-3.5 w-3.5 shrink-0"
                                aria-hidden
                              />
                            )}
                            {offRoster.length === 1
                              ? "Add to Team"
                              : `Add ${offRoster.length} to Team`}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => toggleGroup(g.key)}
                          aria-expanded={open}
                          aria-controls={`followups-group-body-${g.key}`}
                          aria-label={open ? "Collapse group" : "Expand group"}
                          className="inline-flex shrink-0 items-center justify-center self-stretch px-3 text-zinc-500 transition-colors hover:bg-zinc-800/40 hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/60"
                        >
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 shrink-0 transition-transform duration-300 ease-out",
                              open ? "rotate-180" : "rotate-0"
                            )}
                            aria-hidden
                          />
                        </button>
                      </div>
                    );
                  })()}
                  <div
                    id={`followups-group-body-${g.key}`}
                    className={cn(
                      "grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none",
                      open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                    )}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <ul className="divide-y divide-zinc-800/80">
                        {g.rows.map((row) => {
                          const now = new Date();
                          const msgAt = entrySlackMessageDate(row.entry);
                          const ageLabel = formatMessageAgeShort(msgAt, now);
                          const animDelay = rowIndex * 40;
                          rowIndex += 1;
                          const channelHref = slackChannelUrl(
                            row.entry.channelId
                          );
                          const channelLabel =
                            row.entry.channelKind === "mpim"
                              ? "group DM"
                              : row.entry.channelName?.trim()
                                ? `#${row.entry.channelName.replace(/^#+/, "")}`
                                : "#channel";
                          return (
                            <li
                              key={row.entry.id}
                              className="motion-safe:animate-[unrepliedFade_0.4s_ease-out_both] motion-reduce:animate-none"
                              style={{
                                animationDelay: `${animDelay}ms`,
                                animationFillMode: "backwards",
                              }}
                            >
                              <div
                                className={cn(
                                  "group/row flex flex-col gap-0 rounded-lg px-4 py-3 sm:px-5",
                                  "border border-transparent",
                                  "transition-[background-color,box-shadow] duration-200 ease-out",
                                  "hover:border-zinc-800/50 hover:bg-zinc-800/20 hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05),0_1px_0_0_rgba(0,0,0,0.12)]",
                                  "active:border-zinc-800/40 active:bg-zinc-800/25",
                                  "motion-reduce:transition-none"
                                )}
                              >
                                <div className="flex min-w-0 gap-2">
                                  <Avatar
                                    src={row.founderProfilePicturePath}
                                    name={row.founderName}
                                    size="md"
                                    className="self-start pt-px"
                                  />
                                  <div className="min-w-0 flex-1 space-y-0">
                                    <div className="flex min-w-0 items-center justify-between gap-1.5">
                                      <div className="min-w-0 flex-1">
                                        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                          <span className="truncate text-sm font-semibold leading-relaxed text-zinc-200">
                                            {row.founderName}
                                          </span>
                                          {row.entry.channelKind === "mpim" ? (
                                            <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
                                              <span aria-hidden>·</span>
                                              <span>group DM</span>
                                            </span>
                                          ) : (
                                            <span className="inline-flex min-w-0 max-w-full -translate-y-1 items-baseline gap-x-2">
                                              <a
                                                href={channelHref}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex min-w-0 max-w-full items-baseline gap-0.5 text-[11px] text-zinc-400 transition-colors hover:text-zinc-200"
                                                title={`Open ${channelLabel} in Slack`}
                                              >
                                                <Hash
                                                  className="h-3 w-3 shrink-0"
                                                  aria-hidden
                                                />
                                                <span className="truncate">
                                                  {(
                                                    row.entry.channelName?.trim() ||
                                                    "channel"
                                                  ).replace(/^#+/, "")}
                                                </span>
                                              </a>
                                              <span
                                                className="text-[11px] text-zinc-500"
                                                aria-hidden
                                              >
                                                ·
                                              </span>
                                              <span className="text-[11px] tabular-nums text-zinc-500">
                                                {ageLabel}
                                              </span>
                                            </span>
                                          )}
                                          {row.entry.channelKind === "mpim" ? (
                                            <>
                                              <span
                                                className="text-[11px] text-zinc-500"
                                                aria-hidden
                                              >
                                                ·
                                              </span>
                                              <span className="text-[11px] tabular-nums text-zinc-500">
                                                {ageLabel}
                                              </span>
                                            </>
                                          ) : null}
                                        </div>
                                      </div>
                                      <div
                                        className={cn(
                                          "inline-flex max-w-full shrink-0 flex-nowrap items-center justify-end gap-1 transition-opacity duration-200 motion-reduce:transition-none",
                                          "max-sm:opacity-100 max-sm:pointer-events-auto",
                                          "sm:pointer-events-none sm:opacity-0",
                                          "sm:group-hover/row:pointer-events-auto sm:group-hover/row:opacity-100",
                                          "sm:group-focus-within/row:pointer-events-auto sm:group-focus-within/row:opacity-100",
                                          "sm:[&:has([aria-expanded='true'])]:pointer-events-auto sm:[&:has([aria-expanded='true'])]:opacity-100"
                                        )}
                                        role="group"
                                        aria-label="Followup actions"
                                      >
                                        <ThreadPreviewButton
                                          slackUrl={row.entry.permalink}
                                          rosterHints={snapshot.rosterHints}
                                          people={people}
                                          focusTs={row.entry.ts}
                                        />
                                        <QuickReplyButton
                                          slackUrl={row.entry.permalink}
                                          rosterHints={snapshot.rosterHints}
                                          people={people}
                                          assigneeName={row.assigneeName}
                                          onSent={async () => {
                                            const r = await markUnrepliedAskNudged(
                                              row.entry.id
                                            );
                                            if (!r.ok) toast.error(r.error);
                                            startTransition(() => {
                                              router.refresh();
                                            });
                                          }}
                                        />
                                        <SnoozeButton
                                          onSnooze={async (days) => {
                                            const r = await snoozeUnrepliedAsk(
                                              row.entry.id,
                                              days
                                            );
                                            if (!r.ok) {
                                              toast.error(r.error);
                                              return;
                                            }
                                            const dur =
                                              days === 1
                                                ? "1 day"
                                                : `${days} days`;
                                            toast.success(
                                              `Snoozed for ${dur}. It will reappear on a later scan if it's still unreplied.`
                                            );
                                            startTransition(() => {
                                              router.refresh();
                                            });
                                          }}
                                        />
                                        <DismissButton
                                          onDismiss={async () => {
                                            const r = await dismissUnrepliedAsk(
                                              row.entry.id
                                            );
                                            if (!r.ok) toast.error(r.error);
                                            else
                                              startTransition(() => {
                                                router.refresh();
                                              });
                                          }}
                                        />
                                      </div>
                                    </div>
                                    <SlackMentionInlineText
                                      text={row.entry.text}
                                      people={people}
                                      rosterHints={snapshot.rosterHints}
                                      mentionSize="sm"
                                      // Hide the per-mention avatar because the
                                      // assignee's photo is already in the group
                                      // header right above — doubling up reads as
                                      // visual noise in a compact row.
                                      mentionAvatar="hide"
                                      className="mt-0 block whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-200"
                                    />
                                    <SlackReactionsRow
                                      reactions={row.entry.reactions}
                                      size="sm"
                                      className="pt-0"
                                      title="Reactions on this ask"
                                    />
                                  </div>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
