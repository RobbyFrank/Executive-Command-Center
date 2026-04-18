"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Person } from "@/lib/types/tracker";
import {
  ownerFilterDepartmentLabel,
  ownerFilterDepartmentToken,
  isOwnerFilterDepartmentToken,
  isOwnerFilterEmploymentToken,
  isOwnerFilterAutonomyToken,
  ownerFilterAutonomyLabel,
  ownerFilterAutonomyLevel,
  ownerFilterAutonomyToken,
  ownerFilterEmploymentLabel,
  ownerFilterEmploymentToken,
} from "@/lib/owner-filter";
import {
  autonomyShortTitle,
  AUTONOMY_LEVEL_ORDER_DESC,
} from "@/lib/autonomyRoster";
import { DepartmentOptionIcon } from "@/lib/departmentIcons";
import {
  Briefcase,
  Building2,
  ChevronDown,
  Clock,
  Search,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FilterSelectSelectionBadge,
  filterSelectTriggerButtonClass,
} from "./filter-select-trigger";
import { firstNameFromFullName } from "@/lib/personDisplayName";

const EMPLOYMENT_OPTIONS = [
  {
    token: ownerFilterEmploymentToken("inhouse_salaried"),
    label: "In-house" as const,
  },
  {
    token: ownerFilterEmploymentToken("inhouse_hourly"),
    label: "In-house (hourly)" as const,
  },
  {
    token: ownerFilterEmploymentToken("outsourced"),
    label: "Outsourced" as const,
  },
];

const AUTONOMY_OPTIONS = AUTONOMY_LEVEL_ORDER_DESC.map((level) => ({
  token: ownerFilterAutonomyToken(level),
  label: autonomyShortTitle(level),
}));

function AutonomyFilterIcon({ level }: { level: number }) {
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 ring-1 ring-zinc-700 text-[11px] font-semibold tabular-nums text-zinc-300"
      aria-hidden
    >
      {level}
    </span>
  );
}

function EmploymentFilterIcon({ label }: { label: string }) {
  if (label === "Outsourced") {
    return (
      <Briefcase className="h-3.5 w-3.5 text-orange-400/90" aria-hidden />
    );
  }
  if (label === "In-house (hourly)") {
    return <Clock className="h-3.5 w-3.5 text-zinc-400" aria-hidden />;
  }
  return <Building2 className="h-3.5 w-3.5 text-zinc-400" aria-hidden />;
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0][0];
    const b = parts[1][0];
    if (a && b) return (a + b).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

function PersonAvatar({
  person,
  size = "md",
  selected = false,
}: {
  person: Person;
  size?: "sm" | "md";
  selected?: boolean;
}) {
  const path = person.profilePicturePath?.trim();
  const box = size === "sm" ? "h-6 w-6" : "h-7 w-7";
  const textSize = size === "sm" ? "text-[10px]" : "text-xs";
  const ringSelected = selected ? "ring-2 ring-zinc-400" : "ring-1 ring-zinc-700";
  if (path) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={path}
        alt=""
        className={cn(
          "shrink-0 rounded-full object-cover transition-[box-shadow]",
          ringSelected,
          box
        )}
      />
    );
  }
  return (
    <span
      className={cn(
        "shrink-0 rounded-full flex items-center justify-center font-medium transition-[box-shadow]",
        selected
          ? "bg-zinc-700 ring-2 ring-zinc-400 text-zinc-50"
          : "bg-zinc-800 ring-1 ring-zinc-700 text-zinc-300",
        box,
        textSize
      )}
      aria-hidden
    >
      {initialsFromName(person.name)}
    </span>
  );
}

interface OwnerFilterMultiSelectProps {
  people: Person[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function OwnerFilterMultiSelect({
  people,
  selectedIds,
  onChange,
}: OwnerFilterMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [nameSearch, setNameSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const searchFieldId = `${listId}-name-search`;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const departmentsSorted = useMemo(() => {
    const s = new Set<string>();
    for (const p of people) {
      const d = p.department?.trim();
      if (d) s.add(d);
    }
    return [...s].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }, [people]);

  useEffect(() => {
    if (!open) {
      setNameSearch("");
      return;
    }
    const id = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  const q = nameSearch.trim().toLowerCase();

  const filteredEmployment = useMemo(() => {
    if (!q) return [...EMPLOYMENT_OPTIONS];
    return EMPLOYMENT_OPTIONS.filter((o) =>
      o.label.toLowerCase().includes(q)
    );
  }, [q]);

  const filteredAutonomy = useMemo(() => {
    if (!q) return [...AUTONOMY_OPTIONS];
    return AUTONOMY_OPTIONS.filter((o) =>
      o.label.toLowerCase().includes(q)
    );
  }, [q]);

  const filteredDepartments = useMemo(() => {
    if (!q) return departmentsSorted;
    return departmentsSorted.filter((d) => d.toLowerCase().includes(q));
  }, [departmentsSorted, q]);

  const filteredPeople = useMemo(() => {
    if (!q) return people;
    return people.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.department ?? "").toLowerCase().includes(q)
    );
  }, [people, q]);

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onChange([...next]);
    },
    [selectedIds, onChange]
  );

  const clear = useCallback(() => onChange([]), [onChange]);

  const {
    selectedPeople,
    selectedDepartmentLabels,
    selectedEmploymentLabels,
    selectedAutonomyLabels,
  } = useMemo(() => {
    const deptLabels: string[] = [];
    const empLabels: string[] = [];
    const autonomyLabels: string[] = [];
    const plist: Person[] = [];
    const byId = new Map(people.map((p) => [p.id, p]));
    for (const id of selectedIds) {
      if (isOwnerFilterDepartmentToken(id)) {
        const l = ownerFilterDepartmentLabel(id);
        if (l) deptLabels.push(l);
      } else if (isOwnerFilterEmploymentToken(id)) {
        const l = ownerFilterEmploymentLabel(id);
        if (l) empLabels.push(l);
      } else if (isOwnerFilterAutonomyToken(id)) {
        const l = ownerFilterAutonomyLabel(id);
        if (l) autonomyLabels.push(l);
      } else {
        const p = byId.get(id);
        if (p) plist.push(p);
      }
    }
    return {
      selectedPeople: plist,
      selectedDepartmentLabels: deptLabels,
      selectedEmploymentLabels: empLabels,
      selectedAutonomyLabels: autonomyLabels,
    };
  }, [people, selectedIds]);

  const selectionCount =
    selectedPeople.length +
    selectedDepartmentLabels.length +
    selectedEmploymentLabels.length +
    selectedAutonomyLabels.length;

  const singleSelectedAutonomyLevel = useMemo(() => {
    if (selectedIds.length !== 1) return null;
    const id = selectedIds[0];
    if (!isOwnerFilterAutonomyToken(id)) return null;
    return ownerFilterAutonomyLevel(id);
  }, [selectedIds]);

  const buttonSummary =
    selectionCount === 0 ? (
      <>
        <Users className="h-3.5 w-3.5 text-zinc-500 shrink-0" aria-hidden />
        <span className="truncate">All owners</span>
      </>
    ) : selectionCount === 1 && selectedPeople.length === 1 ? (
      <>
        <PersonAvatar person={selectedPeople[0]} size="sm" />
        <span className="truncate min-w-0">
          {firstNameFromFullName(selectedPeople[0].name)}
        </span>
      </>
    ) : selectionCount === 1 && selectedDepartmentLabels.length === 1 ? (
      <>
        <DepartmentOptionIcon
          label={selectedDepartmentLabels[0]}
          className="h-6 w-6 shrink-0"
          iconClassName="h-3 w-3"
        />
        <span className="truncate min-w-0">{selectedDepartmentLabels[0]}</span>
      </>
    ) : selectionCount === 1 && selectedEmploymentLabels.length === 1 ? (
      <>
        <span className="shrink-0">
          <EmploymentFilterIcon label={selectedEmploymentLabels[0]} />
        </span>
        <span className="truncate min-w-0">{selectedEmploymentLabels[0]}</span>
      </>
    ) : selectionCount === 1 && singleSelectedAutonomyLevel !== null ? (
      <>
        <AutonomyFilterIcon level={singleSelectedAutonomyLevel} />
        <span className="truncate min-w-0">{selectedAutonomyLabels[0]}</span>
      </>
    ) : (
      <>
        <Users className="h-3.5 w-3.5 text-zinc-500 shrink-0" aria-hidden />
        <span className="truncate">{selectionCount} selected</span>
      </>
    );

  const listEmpty =
    filteredEmployment.length === 0 &&
    filteredAutonomy.length === 0 &&
    filteredDepartments.length === 0 &&
    filteredPeople.length === 0;

  return (
    <div className="relative min-w-[10rem] w-full max-w-full overflow-visible">
      <span id={`${listId}-label`} className="sr-only">
        Filter by employment, autonomy level, department, or owner
      </span>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-labelledby={`${listId}-label`}
        aria-controls={`${listId}-panel`}
        onClick={() => setOpen((o) => !o)}
        className={filterSelectTriggerButtonClass(
          open,
          selectedIds.length > 0
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {buttonSummary}
          <FilterSelectSelectionBadge count={selectedIds.length} />
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform motion-reduce:transition-none",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            id={`${listId}-panel`}
            role="group"
            aria-label="Employment, autonomy, departments, and owners"
            className="absolute right-0 top-full z-50 mt-1 min-w-full w-max max-w-[calc(100vw-2rem)] rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
          >
            <div className="border-b border-zinc-800 px-2 pb-2 pt-1.5">
              <label htmlFor={searchFieldId} className="sr-only">
                Filter employment, autonomy, departments, or names
              </label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500"
                  aria-hidden
                />
                <input
                  ref={searchInputRef}
                  id={searchFieldId}
                  type="search"
                  value={nameSearch}
                  onChange={(e) => setNameSearch(e.target.value)}
                  placeholder="Search employment, autonomy, departments, or names…"
                  autoComplete="off"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-950/80 py-1.5 pl-8 pr-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                />
              </div>
            </div>
            <div className="max-h-[32rem] overflow-y-auto overflow-x-auto px-1 py-0.5">
              {listEmpty ? (
                <p className="px-2 py-3 text-center text-xs text-zinc-500">
                  {nameSearch.trim()
                    ? `No matches for "${nameSearch.trim()}".`
                    : "No team members."}
                </p>
              ) : (
                <>
                  <div
                    className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500"
                    id={`${listId}-employment-heading`}
                  >
                    Employment
                  </div>
                  {filteredEmployment.length === 0 ? (
                    <p className="px-2 pb-2 text-xs text-zinc-600">
                      No employment filters match.
                    </p>
                  ) : (
                    filteredEmployment.map(({ token, label }) => {
                      const selected = selectedSet.has(token);
                      return (
                        <button
                          key={token}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => toggle(token)}
                          className={cn(
                            "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500",
                            selected
                              ? "bg-zinc-800 text-zinc-50 ring-1 ring-inset ring-zinc-500/80"
                              : "text-zinc-200 hover:bg-zinc-800/60"
                          )}
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 ring-1 ring-zinc-700">
                            <EmploymentFilterIcon label={label} />
                          </span>
                          <span>{label}</span>
                        </button>
                      );
                    })
                  )}

                  <div
                    className="my-1 border-t border-zinc-800"
                    role="separator"
                  />
                  <div
                    className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500"
                    id={`${listId}-autonomy-heading`}
                  >
                    Autonomy
                  </div>
                  {filteredAutonomy.length === 0 ? (
                    <p className="px-2 pb-2 text-xs text-zinc-600">
                      No autonomy levels match.
                    </p>
                  ) : (
                    filteredAutonomy.map(({ token, label }) => {
                      const selected = selectedSet.has(token);
                      const level = ownerFilterAutonomyLevel(token);
                      return (
                        <button
                          key={token}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => toggle(token)}
                          className={cn(
                            "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500",
                            selected
                              ? "bg-zinc-800 text-zinc-50 ring-1 ring-inset ring-zinc-500/80"
                              : "text-zinc-200 hover:bg-zinc-800/60"
                          )}
                        >
                          {level !== null ? (
                            <AutonomyFilterIcon level={level} />
                          ) : null}
                          <span className="min-w-0 whitespace-normal leading-snug">
                            {label}
                          </span>
                        </button>
                      );
                    })
                  )}

                  {departmentsSorted.length > 0 ? (
                    <>
                      <div
                        className="my-1 border-t border-zinc-800"
                        role="separator"
                      />
                      <div
                        className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500"
                        id={`${listId}-dept-heading`}
                      >
                        Departments
                      </div>
                      {filteredDepartments.length === 0 ? (
                        <p className="px-2 pb-2 text-xs text-zinc-600">
                          No departments match.
                        </p>
                      ) : (
                        filteredDepartments.map((dept) => {
                          const deptToken = ownerFilterDepartmentToken(dept);
                          const selected = selectedSet.has(deptToken);
                          return (
                            <button
                              key={deptToken}
                              type="button"
                              aria-pressed={selected}
                              onClick={() => toggle(deptToken)}
                              className={cn(
                                "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500",
                                selected
                                  ? "bg-zinc-800 text-zinc-50 ring-1 ring-inset ring-zinc-500/80"
                                  : "text-zinc-200 hover:bg-zinc-800/60"
                              )}
                            >
                              <DepartmentOptionIcon
                                label={dept}
                                className="h-7 w-7 shrink-0"
                                iconClassName="h-3.5 w-3.5"
                              />
                              <span>{dept}</span>
                            </button>
                          );
                        })
                      )}
                    </>
                  ) : null}

                  <div
                    className="my-1 border-t border-zinc-800"
                    role="separator"
                  />
                  <div
                    className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500"
                    id={`${listId}-people-heading`}
                  >
                    People
                  </div>
                  {filteredPeople.length === 0 ? (
                    <p className="px-2 py-2 text-xs text-zinc-600">
                      {people.length > 0
                        ? "No people match."
                        : "No team members."}
                    </p>
                  ) : (
                    filteredPeople.map((person) => {
                      const selected = selectedSet.has(person.id);
                      return (
                        <button
                          key={person.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => toggle(person.id)}
                          className={cn(
                            "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500",
                            selected
                              ? "bg-zinc-800 text-zinc-50 ring-1 ring-inset ring-zinc-500/80"
                              : "text-zinc-200 hover:bg-zinc-800/60"
                          )}
                        >
                          <PersonAvatar person={person} selected={selected} />
                          <span className="flex min-w-0 flex-col gap-0">
                            <span>{firstNameFromFullName(person.name)}</span>
                            {person.department?.trim() ? (
                              <span className="text-[11px] text-zinc-500 truncate">
                                {person.department.trim()}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })
                  )}
                </>
              )}
            </div>
            {selectedIds.length > 0 ? (
              <div className="border-t border-zinc-800 px-2 py-1.5 whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => {
                    clear();
                    setOpen(false);
                  }}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                >
                  Clear selection
                </button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
