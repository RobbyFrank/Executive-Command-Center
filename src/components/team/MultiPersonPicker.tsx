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
import { Check, ChevronDown, Plus } from "lucide-react";
import type { Person } from "@/lib/types/tracker";
import { firstNameFromFullName } from "@/lib/personDisplayName";
import {
  autonomyShortTitle,
  buildTeamRosterDisplayGroups,
  clampAutonomy,
  isFounderPerson,
} from "@/lib/autonomyRoster";
import { cn } from "@/lib/utils";

interface MultiPersonPickerProps {
  /** Full eligible roster (caller filters out the new hire, founders, etc.). */
  people: Person[];
  /** Currently selected ids. Controlled. */
  selectedIds: Set<string>;
  /** Fires with the chosen person id (caller toggles `selectedIds`). */
  onToggle: (personId: string) => void;
  /**
   * Ids rendered as disabled rows with a tooltip (e.g. already on-card or missing Slack id).
   * The entry label is a short reason, shown as a muted badge.
   */
  disabledReasons?: Map<string, string>;
  /** Button label when the panel is closed. Defaults to "Add onboarding partner…". */
  label?: string;
  /** Panel max-height in px. Defaults to 360. */
  maxHeight?: number;
}

const PANEL_W = 320;

/**
 * Multi-select person picker styled to match `OwnerPickerCell` (avatars, autonomy groups,
 * search). Unlike the single-select picker, this one stays open while the caller toggles
 * selections and shows a running checkmark next to each chosen person.
 *
 * Designed for contexts (like the onboarding recommender) where the caller renders its own
 * "selected people" cards above the button; this component is intentionally trigger-only
 * and does not show pills inside itself.
 */
export function MultiPersonPicker({
  people,
  selectedIds,
  onToggle,
  disabledReasons,
  label = "Add onboarding partner…",
  maxHeight = 360,
}: MultiPersonPickerProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [search, setSearch] = useState("");
  const anchorRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => setMounted(true), []);

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
    if (top + maxHeight > vh) top = Math.max(margin, rect.top - maxHeight - 4);
    setPos({ top, left });
  }, [open, maxHeight]);

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

  const groups = useMemo(
    () => buildTeamRosterDisplayGroups(people),
    [people]
  );

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        people: g.people.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.department?.toLowerCase().includes(q) ?? false) ||
            (p.role?.toLowerCase().includes(q) ?? false)
        ),
      }))
      .filter((g) => g.people.length > 0);
  }, [groups, search]);

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
                    width: PANEL_W,
                    maxHeight,
                  }}
                  role="listbox"
                  aria-label="Add onboarding partner"
                  aria-multiselectable="true"
                >
                  <div className="border-b border-zinc-800 px-3 py-2">
                    <input
                      ref={searchRef}
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search by name, role, or department…"
                      className="w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                    />
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                    {filteredGroups.length === 0 ? (
                      <p className="px-3 py-4 text-center text-sm text-zinc-500">
                        No matches
                      </p>
                    ) : (
                      filteredGroups.map((group) => {
                        const isFounders = group.kind === "founders";
                        const label =
                          group.kind === "founders"
                            ? "Founders"
                            : group.kind === "autonomy"
                              ? `${group.level}. ${autonomyShortTitle(group.level)}`
                              : "Team";
                        const groupKey =
                          group.kind === "founders"
                            ? "__founders__"
                            : group.kind === "autonomy"
                              ? `autonomy-${group.level}`
                              : `other-${isFounders}`;
                        return (
                          <div key={groupKey}>
                            <div className="sticky top-0 z-10 border-t border-zinc-800 bg-zinc-900/95 px-3 py-1.5 backdrop-blur-sm">
                              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                                {label}
                              </span>
                            </div>
                            {group.people.map((p) => (
                              <PersonOptionRow
                                key={p.id}
                                person={p}
                                selected={selectedIds.has(p.id)}
                                disabledReason={disabledReasons?.get(p.id)}
                                onSelect={() => {
                                  if (disabledReasons?.has(p.id)) return;
                                  onToggle(p.id);
                                }}
                              />
                            ))}
                          </div>
                        );
                      })
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

function PersonOptionRow({
  person,
  selected,
  disabledReason,
  onSelect,
}: {
  person: Person;
  selected: boolean;
  disabledReason?: string;
  onSelect: () => void;
}) {
  const photo = person.profilePicturePath?.trim();
  const dept = person.department?.trim();
  const role = person.role?.trim();
  const firstName = firstNameFromFullName(person.name);
  const isFounder = isFounderPerson(person);
  const autonomy = clampAutonomy(person.autonomyScore);
  const disabled = Boolean(disabledReason);
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "group/person flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm transition-colors",
        disabled
          ? "cursor-not-allowed opacity-50"
          : "cursor-pointer hover:bg-zinc-800",
        selected && !disabled && "bg-zinc-800/60"
      )}
      role="option"
      aria-selected={selected}
      title={disabledReason}
    >
      {photo ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={photo}
          alt=""
          className={cn(
            "h-7 w-7 shrink-0 rounded-full object-cover ring-2",
            selected ? "ring-emerald-500/60" : "ring-zinc-700"
          )}
        />
      ) : (
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ring-2",
            selected
              ? "bg-emerald-950/50 text-emerald-300 ring-emerald-500/60"
              : "bg-zinc-800 text-zinc-400 ring-zinc-700"
          )}
        >
          {firstName.charAt(0).toUpperCase()}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium text-zinc-100">
            {person.name}
          </span>
          {!isFounder && (
            <span
              className={cn(
                "shrink-0 rounded px-1 py-px text-[10px] font-semibold tabular-nums",
                autonomy >= 4
                  ? "bg-emerald-500/10 text-emerald-400/80"
                  : autonomy === 3
                    ? "bg-zinc-700/50 text-zinc-400"
                    : autonomy === 0
                      ? "bg-zinc-800/80 text-zinc-500"
                      : "bg-amber-500/10 text-amber-400/80"
              )}
              title={`Autonomy ${autonomy}`}
            >
              A{autonomy}
            </span>
          )}
        </div>
        {(role || dept) && (
          <span className="truncate text-[11px] leading-tight text-zinc-500">
            {[role, dept].filter(Boolean).join(" · ")}
          </span>
        )}
      </div>

      {selected ? (
        <Check
          className="h-4 w-4 shrink-0 text-emerald-400"
          aria-hidden
        />
      ) : disabledReason ? (
        <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
          {disabledReason}
        </span>
      ) : null}
    </button>
  );
}
