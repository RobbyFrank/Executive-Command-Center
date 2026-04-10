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
import { ChevronDown, AlertTriangle } from "lucide-react";
import type { Person } from "@/lib/types/tracker";
import { firstNameFromFullName } from "@/lib/personDisplayName";
import {
  buildTeamRosterDisplayGroups,
  clampAutonomy,
  isFounderPersonId,
  AUTONOMY_GROUP_LABEL,
  autonomyShortTitle,
  type AutonomyLevel,
} from "@/lib/autonomyRoster";
import { cn } from "@/lib/utils";

export interface OwnerWorkload {
  total: number;
  p0: number;
  p1: number;
}

interface OwnerPickerCellProps {
  people: Person[];
  value: string;
  onSave: (ownerId: string) => void;
  /** Priority of the parent entity — used to warn about low-autonomy owners on P0/P1. */
  priority?: string;
  /** P0/P1 workload per person id — shown in the dropdown. */
  workloadMap?: Map<string, OwnerWorkload>;
}

const PANEL_W = 320;

export function OwnerPickerCell({
  people,
  value,
  onSave,
  priority,
  workloadMap,
}: OwnerPickerCellProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [search, setSearch] = useState("");
  const anchorRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const isHighPriority = priority === "P0" || priority === "P1";

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
    if (top + 360 > vh) top = Math.max(margin, rect.top - 360 - 4);
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

  const select = useCallback(
    (id: string) => {
      if (id !== value) onSave(id);
      close();
    },
    [value, onSave, close],
  );

  const groups = useMemo(
    () => buildTeamRosterDisplayGroups(people),
    [people],
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
            (p.department?.toLowerCase().includes(q) ?? false),
        ),
      }))
      .filter((g) => g.people.length > 0);
  }, [groups, search]);

  const person = people.find((p) => p.id === value);
  const displayName = person
    ? firstNameFromFullName(person.name)
    : undefined;
  const dept = person?.department?.trim();
  const photo = person?.profilePicturePath?.trim();
  const title = person
    ? [person.name, dept].filter(Boolean).join(" · ")
    : "Click to assign owner";
  const autonomyRing =
    person &&
    !isFounderPersonId(person.id) &&
    clampAutonomy(person.autonomyScore) <= 2;

  const collapsed = (
    <button
      ref={anchorRef}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setOpen(!open);
      }}
      className="group/owner relative flex min-h-[28px] w-full min-w-0 max-w-full cursor-pointer items-center rounded py-0.5 pl-1.5 pr-7 text-left text-sm transition-colors hover:bg-zinc-800"
      title={title}
    >
      {person ? (
        photo ? (
          <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo}
              alt=""
              className={cn(
                "h-6 w-6 shrink-0 rounded-full object-cover ring-2",
                autonomyRing ? "ring-amber-500/75" : "ring-zinc-700",
              )}
            />
            {dept ? (
              <span className="min-w-0 truncate text-[11px] leading-tight text-zinc-400">
                {dept}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
            {autonomyRing ? (
              <span
                className="h-2 w-2 shrink-0 rounded-full bg-amber-500/90 ring-1 ring-amber-400/50"
                aria-hidden
              />
            ) : null}
            <span className="min-w-0 truncate">
              <span className="text-zinc-100">{displayName}</span>
              {dept ? (
                <span className="text-zinc-500"> · {dept}</span>
              ) : null}
            </span>
          </span>
        )
      ) : (
        <span className="italic text-zinc-600">Unassigned</span>
      )}
      <ChevronDown
        className="pointer-events-none absolute right-1 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500 opacity-0 transition-opacity group-hover/owner:opacity-100"
        aria-hidden
      />
    </button>
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
            className="fixed z-[110] flex max-h-[360px] flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
            style={{ top: pos.top, left: pos.left, width: PANEL_W }}
            role="listbox"
            aria-label="Choose owner"
          >
            <div className="border-b border-zinc-800 px-3 py-2">
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or department..."
                className="w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
              />
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain">
              {/* Unassigned option */}
              <button
                type="button"
                onClick={() => select("")}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-800",
                  value === "" && "bg-zinc-800/60",
                )}
                role="option"
                aria-selected={value === ""}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs text-zinc-500">
                  ?
                </span>
                <span className="min-w-0 text-zinc-400 italic">
                  Unassigned
                </span>
              </button>

              {filteredGroups.map((group) => {
                const isFounders = group.kind === "founders";
                const label = isFounders
                  ? "Founders"
                  : `${group.level}. ${autonomyShortTitle(group.level)}`;

                return (
                  <div key={isFounders ? "__founders__" : group.level}>
                    <div className="sticky top-0 z-10 border-t border-zinc-800 bg-zinc-900/95 px-3 py-1.5 backdrop-blur-sm">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                        {label}
                      </span>
                    </div>
                    {group.people.map((p) => (
                      <PersonOption
                        key={p.id}
                        person={p}
                        selected={p.id === value}
                        isHighPriority={isHighPriority}
                        onSelect={() => select(p.id)}
                        workload={workloadMap?.get(p.id)}
                      />
                    ))}
                  </div>
                );
              })}

              {filteredGroups.length === 0 && (
                <p className="px-3 py-4 text-center text-sm text-zinc-500">
                  No matches
                </p>
              )}
            </div>
          </div>
        )}
      </>
    ) : null;

  return (
    <div className="w-full min-w-0 cursor-pointer" onClick={(e) => e.stopPropagation()}>
      {collapsed}
      {mounted && overlay ? createPortal(overlay, document.body) : null}
    </div>
  );
}

function PersonOption({
  person,
  selected,
  isHighPriority,
  onSelect,
  workload,
}: {
  person: Person;
  selected: boolean;
  isHighPriority: boolean;
  onSelect: () => void;
  workload?: OwnerWorkload;
}) {
  const photo = person.profilePicturePath?.trim();
  const dept = person.department?.trim();
  const displayName = person.name;
  const firstName = firstNameFromFullName(person.name);
  const isFounder = isFounderPersonId(person.id);
  const autonomy = clampAutonomy(person.autonomyScore);
  const lowAutonomy = !isFounder && autonomy < 4;
  const showWarning = isHighPriority && lowAutonomy;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group/person flex w-full cursor-pointer items-center gap-3 px-3 py-1.5 text-left text-sm transition-colors hover:bg-zinc-800",
        selected && "bg-zinc-800/60",
        showWarning && "hover:bg-amber-950/30",
      )}
      role="option"
      aria-selected={selected}
      title={
        showWarning
          ? `Autonomy ${autonomy} — consider assigning someone with higher autonomy for a P0/P1 item`
          : undefined
      }
    >
      {/* Avatar */}
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt=""
          className={cn(
            "h-7 w-7 shrink-0 rounded-full object-cover ring-2",
            showWarning
              ? "ring-amber-500/60"
              : selected
                ? "ring-blue-500/60"
                : "ring-zinc-700",
          )}
        />
      ) : (
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium",
            showWarning
              ? "bg-amber-950/50 text-amber-300 ring-2 ring-amber-500/60"
              : selected
                ? "bg-blue-950/50 text-blue-300 ring-2 ring-blue-500/60"
                : "bg-zinc-800 text-zinc-400 ring-2 ring-zinc-700",
          )}
        >
          {firstName.charAt(0).toUpperCase()}
        </span>
      )}

      {/* Name + dept + autonomy */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "truncate font-medium",
              showWarning ? "text-amber-200/90" : "text-zinc-100",
            )}
          >
            {displayName}
          </span>
          {!isFounder && (
            <span
              className={cn(
                "shrink-0 rounded px-1 py-px text-[10px] font-semibold tabular-nums",
                autonomy >= 4
                  ? "bg-emerald-500/10 text-emerald-400/80"
                  : autonomy === 3
                    ? "bg-zinc-700/50 text-zinc-400"
                    : "bg-amber-500/10 text-amber-400/80",
              )}
            >
              A{autonomy}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {dept && (
            <span className="truncate text-[11px] leading-tight text-zinc-500">
              {dept}
            </span>
          )}
          {workload && (workload.p0 > 0 || workload.p1 > 0) && (
            <span className="flex shrink-0 items-center gap-1.5 text-[10px] leading-tight text-zinc-500">
              {dept && <span className="text-zinc-700">&middot;</span>}
              {workload.p0 > 0 && (
                <span className="font-medium text-red-400/70">
                  {workload.p0} P0
                </span>
              )}
              {workload.p1 > 0 && (
                <span className="font-medium text-orange-400/70">
                  {workload.p1} P1
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Warning for high-priority + low autonomy */}
      {showWarning && (
        <div className="flex shrink-0 items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5">
          <AlertTriangle className="h-3 w-3 text-amber-400" />
          <span className="text-[10px] font-medium text-amber-300">
            Low autonomy
          </span>
        </div>
      )}
    </button>
  );
}
