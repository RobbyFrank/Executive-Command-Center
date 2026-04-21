"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { Person, Project } from "@/lib/types/tracker";
import {
  daysSinceJoined,
  findPilotProjectsFor,
} from "@/lib/onboarding";
import { UserPlus } from "lucide-react";
import { LocalImageField } from "@/components/tracker/LocalImageField";
import { cn } from "@/lib/utils";

const SKIP_PANEL_MAX_W = 288;

function SkipNewHireConfirmPopover({
  personName,
  onConfirm,
}: {
  personName: string;
  onConfirm: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const [panelBox, setPanelBox] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const updatePanelPosition = useCallback(() => {
    if (!open || !anchorRef.current) {
      setPanelBox(null);
      return;
    }
    const rect = anchorRef.current.getBoundingClientRect();
    const margin = 8;
    const vw = typeof window !== "undefined" ? window.innerWidth : 800;
    const width = Math.min(SKIP_PANEL_MAX_W, vw - margin * 2);
    let left = rect.right - width;
    left = Math.max(margin, Math.min(left, vw - width - margin));
    const top = rect.bottom + 4;
    setPanelBox({ top, left, width });
  }, [open]);

  useLayoutEffect(() => {
    updatePanelPosition();
  }, [updatePanelPosition]);

  useLayoutEffect(() => {
    if (!open) return;
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [open, updatePanelPosition]);

  function close() {
    setOpen(false);
    setError(null);
    setPending(false);
    setPanelBox(null);
  }

  const overlay =
    mounted && open ? (
      <>
        <div
          className="fixed inset-0 z-[100]"
          aria-hidden
          onClick={() => close()}
        />
        {panelBox ? (
          <div
            className="fixed z-[110] max-h-[min(80vh,calc(100vh-2rem))] overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 p-3 shadow-lg"
            style={{
              top: panelBox.top,
              left: panelBox.left,
              width: panelBox.width,
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
          >
            <p id={headingId} className="mb-1 text-xs font-medium text-zinc-200">
              Skip {personName} from New hires?
            </p>
            <p className="mb-2 text-xs leading-snug text-zinc-500">
              They&apos;ll stop appearing in this list. If you later change their
              join date, they&apos;ll come back automatically.
            </p>
            {error && (
              <p className="mb-2 text-xs leading-snug text-amber-500/95">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => close()}
                disabled={pending}
                className="cursor-pointer px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={async () => {
                  setError(null);
                  setPending(true);
                  try {
                    await Promise.resolve(onConfirm());
                    close();
                  } catch (e) {
                    setError(
                      e instanceof Error ? e.message : "Something went wrong."
                    );
                  } finally {
                    setPending(false);
                  }
                }}
                className="cursor-pointer rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-100 hover:border-zinc-500 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? "…" : "Skip"}
              </button>
            </div>
          </div>
        ) : null}
      </>
    ) : null;

  return (
    <div className="relative inline-flex" ref={anchorRef}>
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          setError(null);
        }}
        className="inline-flex items-center rounded-md border border-zinc-600 bg-zinc-900/90 px-2.5 py-1.5 text-xs font-medium text-zinc-400 shadow-sm transition-colors hover:border-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/40"
      >
        Skip
      </button>
      {mounted && overlay ? createPortal(overlay, document.body) : null}
    </div>
  );
}

export function NewHireRow({
  person,
  projects,
  todayYmd,
  onRecommendPilot,
  onSkip,
}: {
  person: Person;
  projects: Project[];
  todayYmd: string;
  onRecommendPilot: () => void;
  onSkip: () => void | Promise<void>;
}) {
  const pilots = findPilotProjectsFor(person, projects);
  const hasPilot = pilots.length > 0;
  const days = daysSinceJoined(person, todayYmd);

  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 rounded-lg border px-4 py-3",
        hasPilot
          ? "border-emerald-800/60 bg-emerald-950/25"
          : "border-amber-800/50 bg-amber-950/20"
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="shrink-0 pt-0.5">
          <LocalImageField
            variant="person"
            entityId={person.id}
            path={person.profilePicturePath ?? ""}
          />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-zinc-100 truncate">
            {person.name}
          </p>
          <p className="text-xs text-zinc-500">
            {(person.role ?? "").trim() || "Role not set"}
            {days !== null ? (
              <>
                {" · "}
                <span className="tabular-nums">
                  {days === 0
                    ? "Joined today"
                    : days === 1
                      ? "Joined yesterday"
                      : `Joined ${days} days ago`}
                </span>
              </>
            ) : null}
          </p>
          {hasPilot ? (
            <p className="text-xs font-medium text-emerald-400/90">
              Pilot:{" "}
              <span className="text-emerald-300/95">{pilots[0]!.name}</span>
            </p>
          ) : (
            <p className="text-xs font-medium text-amber-400/90">
              No pilot yet
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={onRecommendPilot}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-emerald-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
        >
          <UserPlus className="h-3.5 w-3.5 shrink-0 opacity-95" aria-hidden />
          Assign onboarding project
        </button>
        <SkipNewHireConfirmPopover
          personName={person.name}
          onConfirm={onSkip}
        />
      </div>
    </div>
  );
}
