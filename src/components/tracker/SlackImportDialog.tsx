"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Search, User, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { SlackMember } from "@/lib/slack";
import {
  fetchSlackMembers,
  importSlackMembers,
  type SlackImportMemberPayload,
} from "@/server/actions/slack";
import { SlackLogo } from "./SlackLogo";

interface SlackImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Uppercase Slack user IDs already stored on the roster. */
  existingSlackIds: Set<string>;
}

function memberDisplayName(m: SlackMember): string {
  return m.realName || m.displayName || m.id;
}

export function SlackImportDialog({
  open,
  onClose,
  existingSlackIds,
}: SlackImportDialogProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [members, setMembers] = useState<SlackMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  /** When false, rows already on the roster are hidden so the list focuses on new imports. */
  const [showExistingMembers, setShowExistingMembers] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setMembers([]);
    setFetchError(null);
    setSearchQuery("");
    setSelectedIds(new Set());
    setImportError(null);
    setShowExistingMembers(false);
    setLoading(true);

    void (async () => {
      const r = await fetchSlackMembers();
      if (cancelled) return;
      setLoading(false);
      if (r.ok) {
        setMembers(r.members);
      } else {
        setFetchError(r.error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const membersMatchingSearch = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => {
      const blob = [
        m.id,
        m.realName,
        m.displayName,
        m.email,
        m.joinDate,
        m.billingLabel,
      ]
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [members, searchQuery]);

  const visibleMembers = useMemo(() => {
    if (showExistingMembers) return membersMatchingSearch;
    return membersMatchingSearch.filter(
      (m) => !existingSlackIds.has(m.id.toUpperCase())
    );
  }, [membersMatchingSearch, showExistingMembers, existingSlackIds]);

  const toggleId = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllImportable = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const m of visibleMembers) {
        const sid = m.id.toUpperCase();
        if (!existingSlackIds.has(sid)) next.add(m.id);
      }
      return next;
    });
  }, [visibleMembers, existingSlackIds]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectedImportableCount = useMemo(() => {
    let n = 0;
    for (const id of selectedIds) {
      const u = id.toUpperCase();
      if (!existingSlackIds.has(u)) n += 1;
    }
    return n;
  }, [selectedIds, existingSlackIds]);

  const alreadyOnTeamCount = useMemo(() => {
    return members.filter((m) => existingSlackIds.has(m.id.toUpperCase())).length;
  }, [members, existingSlackIds]);

  const importableCount = members.length - alreadyOnTeamCount;

  const billingBreakdown = useMemo(() => {
    let active = 0;
    let activeGuest = 0;
    for (const m of members) {
      if (m.billingLabel === "Active guest") activeGuest += 1;
      else active += 1;
    }
    return { active, activeGuest };
  }, [members]);

  const onImport = useCallback(async () => {
    const payload: SlackImportMemberPayload[] = [];
    for (const m of members) {
      if (!selectedIds.has(m.id)) continue;
      if (existingSlackIds.has(m.id.toUpperCase())) continue;
      payload.push({
        id: m.id,
        realName: m.realName,
        displayName: m.displayName,
        email: m.email,
        avatarUrl: m.avatarUrl,
        joinDate: m.joinDate,
      });
    }
    if (payload.length === 0) return;

    setImporting(true);
    setImportError(null);
    try {
      const r = await importSlackMembers(payload);
      if (!r.ok) {
        setImportError(r.error);
        return;
      }
      if (r.avatarWarnings.length > 0) {
        toast.warning("Some profile photos could not be saved", {
          description: r.avatarWarnings.slice(0, 3).join(" · "),
        });
      }
      toast.success(
        r.imported.length === 1
          ? "Imported 1 team member"
          : `Imported ${r.imported.length} team members`
      );
      router.refresh();
      onClose();
    } catch (e) {
      setImportError(
        e instanceof Error ? e.message : "Import failed unexpectedly."
      );
    } finally {
      setImporting(false);
    }
  }, [members, selectedIds, existingSlackIds, router, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Import team members from Slack"
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[min(92vh,960px)] w-[min(1120px,calc(100vw-2.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-6 border-b border-zinc-700/80 px-8 py-7">
          <div className="min-w-0 flex-1 space-y-3">
            <h2 className="inline-flex items-center gap-3 text-lg font-semibold tracking-tight text-zinc-100">
              <SlackLogo alt="" className="h-6 w-6 opacity-90" />
              Import from Slack
            </h2>
            <p className="w-full min-w-0 text-sm leading-relaxed text-zinc-400">
              Add people to your team roster. We pull profile photo, name, email, and join date when
              your Slack workspace exposes them.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/45"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Toolbar: search + stats + bulk actions */}
        <div className="space-y-5 border-b border-zinc-800 px-8 py-6">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
              aria-hidden
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, email, or Slack ID…"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950/50 py-3 pl-11 pr-4 text-[15px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-500/40"
              disabled={loading || !!fetchError}
              aria-label="Filter Slack members"
            />
          </div>
          {!loading && !fetchError && members.length > 0 && alreadyOnTeamCount > 0 ? (
            <label className="flex cursor-pointer items-center gap-3 text-sm text-zinc-400 select-none">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 rounded border-zinc-600 bg-zinc-900 text-blue-600 focus:ring-2 focus:ring-blue-500/40"
                checked={showExistingMembers}
                onChange={(e) => setShowExistingMembers(e.target.checked)}
              />
              <span>Show people already on the team</span>
            </label>
          ) : null}
          {!loading && !fetchError && members.length > 0 ? (
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5 xl:gap-6">
                <div className="rounded-lg border border-zinc-800/90 bg-zinc-950/35 px-4 py-3">
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                    Active
                  </dt>
                  <dd className="mt-1 tabular-nums text-lg font-medium text-zinc-100">
                    {billingBreakdown.active}
                  </dd>
                </div>
                <div className="rounded-lg border border-zinc-800/90 bg-zinc-950/35 px-4 py-3">
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                    Active guests
                  </dt>
                  <dd className="mt-1 tabular-nums text-lg font-medium text-zinc-100">
                    {billingBreakdown.activeGuest}
                  </dd>
                </div>
                <div className="rounded-lg border border-zinc-800/90 bg-zinc-950/35 px-4 py-3">
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                    In list
                  </dt>
                  <dd className="mt-1 tabular-nums text-lg font-medium text-zinc-100">
                    {members.length}
                  </dd>
                </div>
                <div className="rounded-lg border border-zinc-800/90 bg-zinc-950/35 px-4 py-3">
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                    On team
                  </dt>
                  <dd className="mt-1 tabular-nums text-lg font-medium text-zinc-300">
                    {alreadyOnTeamCount}
                  </dd>
                </div>
                <div className="rounded-lg border border-emerald-950/40 bg-emerald-950/15 px-4 py-3">
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-emerald-600/90">
                    Importable
                  </dt>
                  <dd className="mt-1 tabular-nums text-lg font-medium text-emerald-400/95">
                    {importableCount}
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={selectAllImportable}
                  disabled={visibleMembers.length === 0}
                  className="rounded-lg border border-zinc-700 bg-zinc-800/40 px-4 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Select all shown
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  disabled={selectedIds.size === 0}
                  className="rounded-lg px-4 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear selection
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Member list */}
        <div className="min-h-0 flex-1 overflow-auto px-8 pb-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-28 text-base text-zinc-500">
              <Loader2 className="h-10 w-10 animate-spin text-zinc-500" aria-hidden />
              Loading workspace members…
            </div>
          ) : fetchError ? (
            <p className="px-8 py-12 text-base leading-relaxed text-red-400/95">
              {fetchError}
            </p>
          ) : visibleMembers.length === 0 ? (
            <p className="max-w-md px-8 py-16 text-center text-base leading-relaxed text-zinc-500">
              {members.length === 0 ? (
                "No Active or Active guest members returned from Slack."
              ) : membersMatchingSearch.length === 0 ? (
                "No members match your search."
              ) : (
                <>
                  Everyone matching your search is already on your team. Turn on{" "}
                  <span className="text-zinc-400">Show people already on the team</span>{" "}
                  to see those rows.
                </>
              )}
            </p>
          ) : (
            <table className="w-full min-w-[860px] table-fixed border-collapse text-[15px]">
              <thead className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900/95 backdrop-blur-sm">
                <tr className="text-left text-[11px] font-medium uppercase tracking-widest text-zinc-500">
                  <th className="w-12 py-4 pl-8 pr-2" />
                  <th className="w-[26%] py-4 pr-4 font-medium">Member</th>
                  <th className="w-[13%] py-4 pr-4 font-medium">Billing</th>
                  <th className="w-[28%] py-4 pr-4 font-medium">Email</th>
                  <th className="w-[12%] py-4 pr-4 font-medium">Join date</th>
                  <th className="w-[15%] py-4 pr-8 font-medium">Slack ID</th>
                </tr>
              </thead>
              <tbody>
                {visibleMembers.map((m) => {
                  const sid = m.id.toUpperCase();
                  const already = existingSlackIds.has(sid);
                  const checked = selectedIds.has(m.id);
                  const name = memberDisplayName(m);
                  return (
                    <tr
                      key={m.id}
                      className={cn(
                        "border-b border-zinc-800/60 transition-colors last:border-b-0",
                        already
                          ? "opacity-45"
                          : "cursor-pointer hover:bg-zinc-800/40"
                      )}
                      onClick={() => {
                        if (!already) toggleId(m.id);
                      }}
                    >
                      <td className="py-4 pl-8 pr-2 align-middle">
                        {already ? (
                          <span
                            className="flex h-5 w-5 items-center justify-center rounded border border-zinc-600 bg-zinc-800"
                            title="Already on team"
                          >
                            <Check className="h-3.5 w-3.5 text-zinc-500" aria-hidden />
                          </span>
                        ) : (
                          <input
                            type="checkbox"
                            className="h-5 w-5 shrink-0 cursor-pointer rounded border-zinc-600 bg-zinc-900 text-blue-600 focus:ring-blue-500/40"
                            checked={checked}
                            readOnly
                            tabIndex={-1}
                          />
                        )}
                      </td>
                      <td className="py-4 pr-4 align-middle">
                        <div className="flex min-w-0 items-center gap-3">
                          {m.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={m.avatarUrl}
                              alt=""
                              className="h-10 w-10 shrink-0 rounded-full bg-zinc-800 object-cover"
                            />
                          ) : (
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-800">
                              <User className="h-4 w-4 text-zinc-600" aria-hidden />
                            </span>
                          )}
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-zinc-100">{name}</span>
                              {already ? (
                                <span className="shrink-0 rounded-md bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-500/90">
                                  On team
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 pr-4 align-middle">
                        <span
                          className={cn(
                            "text-sm font-medium",
                            m.billingLabel === "Active guest"
                              ? "text-amber-400/95"
                              : "text-emerald-400/95"
                          )}
                        >
                          {m.billingLabel}
                        </span>
                      </td>
                      <td className="py-4 pr-4 align-middle">
                        <span className="block truncate text-zinc-400">
                          {m.email || (
                            <span className="italic text-zinc-600">No email</span>
                          )}
                        </span>
                      </td>
                      <td className="py-4 pr-4 align-middle">
                        <span className="text-sm tabular-nums text-zinc-400">
                          {m.joinDate || (
                            <span className="text-zinc-600">—</span>
                          )}
                        </span>
                      </td>
                      <td className="py-4 pr-8 align-middle">
                        <code className="break-all text-[12px] leading-snug text-zinc-500 font-mono">
                          {m.id}
                        </code>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {importError ? (
          <div className="border-t border-zinc-800 px-8 py-4">
            <p className="text-sm text-red-400/95">{importError}</p>
          </div>
        ) : null}

        {/* Footer */}
        <div className="flex flex-col gap-4 border-t border-zinc-800 px-8 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-zinc-500">
            {selectedImportableCount > 0 ? (
              <span>
                <span className="tabular-nums text-base font-semibold text-zinc-200">
                  {selectedImportableCount}
                </span>
                {" "}
                {selectedImportableCount === 1 ? "person" : "people"} selected
              </span>
            ) : (
              <span>Select members to import</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-5 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                importing ||
                loading ||
                !!fetchError ||
                selectedImportableCount === 0
              }
              onClick={() => void onImport()}
              className="inline-flex min-w-[7.5rem] items-center justify-center gap-2 rounded-lg bg-zinc-100 px-6 py-2.5 text-sm font-semibold text-zinc-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {importing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Importing…
                </>
              ) : (
                <>
                  Import
                  {selectedImportableCount > 0 ? (
                    <span className="tabular-nums">({selectedImportableCount})</span>
                  ) : null}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
