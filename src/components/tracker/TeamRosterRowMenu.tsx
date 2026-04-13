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
import { useRouter } from "next/navigation";
import { MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import type { Person } from "@/lib/types/tracker";
import { isFounderPerson } from "@/lib/autonomyRoster";
import { deletePerson, updatePerson } from "@/server/actions/tracker";
import { scheduleSlackProfileRefresh } from "@/lib/slackRosterRefresh";
import { SlackLogo } from "./SlackLogo";

const PANEL_MIN_W = 220;

type PanelView = "menu" | "delete";

interface TeamRosterRowMenuProps {
  person: Person;
}

export function TeamRosterRowMenu({ person }: TeamRosterRowMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PanelView>("menu");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuHeadingId = useId();
  const deleteHeadingId = useId();
  const [panelBox, setPanelBox] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const founder = isFounderPerson(person);
  const hasSlackId = Boolean(person.slackHandle?.trim());

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
    const width = Math.max(PANEL_MIN_W, Math.min(288, vw - margin * 2));
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
    setView("menu");
    setError(null);
    setPending(false);
    setPanelBox(null);
  }

  async function onSetFounder() {
    setError(null);
    setPending(true);
    try {
      await updatePerson(person.id, { isFounder: true });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update.");
    } finally {
      setPending(false);
    }
  }

  async function onRemoveFounder() {
    setError(null);
    setPending(true);
    try {
      await updatePerson(person.id, { isFounder: false });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update.");
    } finally {
      setPending(false);
    }
  }

  function onRefreshFromSlack() {
    setError(null);
    close();
    scheduleSlackProfileRefresh(person.id, person.slackHandle, () =>
      router.refresh()
    );
  }

  async function onConfirmDelete() {
    setError(null);
    setPending(true);
    try {
      const result = await deletePerson(person.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete.");
    } finally {
      setPending(false);
    }
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
            className="fixed z-[110] max-h-[min(80vh,calc(100vh-2rem))] overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
            style={{
              top: panelBox.top,
              left: panelBox.left,
              width: panelBox.width,
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby={
              view === "delete" ? deleteHeadingId : menuHeadingId
            }
          >
            {view === "menu" ? (
              <div className="px-1 pb-1">
                <p id={menuHeadingId} className="sr-only">
                  Actions for {person.name}
                </p>
                {error && (
                  <p className="mb-1 px-2 text-xs leading-snug text-amber-500/95">
                    {error}
                  </p>
                )}
                {founder ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void onRemoveFounder()}
                    className="flex w-full cursor-pointer items-center rounded px-2 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800/80 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Remove founder status
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void onSetFounder()}
                    className="flex w-full cursor-pointer items-center rounded px-2 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800/80 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Set as Founder
                  </button>
                )}
                {hasSlackId ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void onRefreshFromSlack()}
                    className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800/80 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5 shrink-0 opacity-70" />
                    <span className="flex-1">Refresh from Slack</span>
                    <SlackLogo alt="" className="h-3.5 w-3.5 opacity-50" />
                  </button>
                ) : null}
                {!founder ? (
                  <>
                    <div
                      className="mx-2 my-1 border-t border-zinc-800"
                      role="separator"
                    />
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setView("delete");
                        setError(null);
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-2 text-left text-sm text-red-400/95 hover:bg-zinc-800/80 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5 shrink-0 opacity-90" />
                      Delete team member…
                    </button>
                  </>
                ) : null}
              </div>
            ) : (
              <div className="p-3">
                <p id={deleteHeadingId} className="mb-2 text-xs text-zinc-300">
                  Delete {person.name}? This can&apos;t be undone.
                </p>
                {error && (
                  <p className="mb-2 text-xs leading-snug text-amber-500/95">
                    {error}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setView("menu");
                      setError(null);
                    }}
                    disabled={pending}
                    className="cursor-pointer px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void onConfirmDelete()}
                    className="cursor-pointer rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pending ? "…" : "Delete"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </>
    ) : null;

  return (
    <div className="relative flex justify-end" ref={anchorRef}>
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          setView("menu");
          setError(null);
        }}
        className={`p-1 transition-colors ${
          open
            ? "text-zinc-300"
            : "cursor-pointer text-zinc-600 opacity-0 hover:text-zinc-400 group-hover:opacity-100"
        }`}
        title="Row actions"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>
      {mounted && overlay ? createPortal(overlay, document.body) : null}
    </div>
  );
}
