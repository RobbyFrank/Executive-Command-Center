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
import { toast } from "sonner";
import { MoreHorizontal, Send, Trash2 } from "lucide-react";
import type { Person } from "@/lib/types/tracker";
import { isFounderPerson } from "@/lib/autonomyRoster";
import { setPersonPassword } from "@/server/actions/auth-admin";

const PANEL_MIN_W = 220;

type PanelView = "menu" | "remove";

interface LoginRowMenuProps {
  person: Person;
  onSendNewPassword: () => void;
}

/**
 * "…" dropdown shown in the Login column once a person has login access. Holds the
 * actions that used to be rendered inline ("Send new password", "Remove login"). Remove
 * is hidden for founders so the caller can't strip their own or another founder's access.
 *
 * Positioning mirrors {@link TeamRosterRowMenu} — a portal-rendered panel anchored to the
 * trigger button so the table's overflow doesn't clip it.
 */
export function LoginRowMenu({
  person,
  onSendNewPassword,
}: LoginRowMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PanelView>("menu");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuHeadingId = useId();
  const removeHeadingId = useId();
  const [panelBox, setPanelBox] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const founder = isFounderPerson(person);

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

  async function onConfirmRemove() {
    setError(null);
    setPending(true);
    try {
      const r = await setPersonPassword(person.id, null);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast.success(`Login access removed for ${person.name}.`);
      close();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove login.");
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
              view === "remove" ? removeHeadingId : menuHeadingId
            }
          >
            {view === "menu" ? (
              <div className="px-1 pb-1">
                <p id={menuHeadingId} className="sr-only">
                  Login actions for {person.name}
                </p>
                {error && (
                  <p className="mb-1 px-2 text-xs leading-snug text-amber-500/95">
                    {error}
                  </p>
                )}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    close();
                    onSendNewPassword();
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800/80 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  <span className="flex-1">Send new password</span>
                </button>
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
                        setView("remove");
                        setError(null);
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-2 text-left text-sm text-red-400/95 hover:bg-zinc-800/80 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5 shrink-0 opacity-90" />
                      Remove login access…
                    </button>
                  </>
                ) : null}
              </div>
            ) : (
              <div className="p-3">
                <p id={removeHeadingId} className="mb-2 text-xs text-zinc-300">
                  Remove login access for {person.name}? They can be given a
                  new login later.
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
                    onClick={() => void onConfirmRemove()}
                    className="cursor-pointer rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pending ? "…" : "Remove"}
                  </button>
                </div>
              </div>
            )}
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
          setView("menu");
          setError(null);
        }}
        className="inline-flex items-center justify-center rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800/70 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
        title="Login actions"
        aria-label="Login actions"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>
      {mounted && overlay ? createPortal(overlay, document.body) : null}
    </div>
  );
}
