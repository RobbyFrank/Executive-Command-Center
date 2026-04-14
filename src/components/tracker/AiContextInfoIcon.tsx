"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { InlineEditCell } from "./InlineEditCell";
import { updateGoal, updateProject } from "@/server/actions/tracker";

const CLOSE_DELAY_MS = 180;
const GRID_ALIGN = { trackerGridAlign: true as const };

type GoalAiContextInfoIconProps = {
  variant: "goal";
  goalId: string;
  measurableTarget: string;
  whyItMatters: string;
  currentValue: string;
};

type ProjectAiContextInfoIconProps = {
  variant: "project";
  projectId: string;
  description: string;
  definitionOfDone: string;
};

type AiContextInfoIconProps =
  | (GoalAiContextInfoIconProps | ProjectAiContextInfoIconProps) & {
      /** Fires when the hover panel is open — use to keep the row icon visible. */
      onUiOpenChange?: (open: boolean) => void;
      /** Sit at the end of the goal/project name: smaller, baseline-aligned with title text. */
      inline?: boolean;
    };

export function AiContextInfoIcon({
  onUiOpenChange,
  inline = false,
  ...props
}: AiContextInfoIconProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [placement, setPlacement] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const filledCount =
    props.variant === "goal"
      ? [
          props.measurableTarget,
          props.whyItMatters,
          props.currentValue,
        ].filter((s) => String(s ?? "").trim().length > 0).length
      : [props.description, props.definitionOfDone].filter(
          (s) => String(s ?? "").trim().length > 0
        ).length;

  const refreshPlacement = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 6;
    const maxW = 400;
    let left = r.left;
    const top = r.bottom + margin;
    if (left + maxW > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - 8 - maxW);
    }
    setPlacement({ top, left });
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current != null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleCloseHover = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setHoverOpen(false);
      closeTimerRef.current = null;
    }, CLOSE_DELAY_MS);
  }, [clearCloseTimer]);

  const openHover = useCallback(() => {
    clearCloseTimer();
    refreshPlacement();
    setHoverOpen(true);
  }, [clearCloseTimer, refreshPlacement]);

  useLayoutEffect(() => {
    if (!hoverOpen) return;
    refreshPlacement();
  }, [hoverOpen, refreshPlacement]);

  useEffect(() => {
    if (!hoverOpen) return;
    const onScroll = () => setHoverOpen(false);
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [hoverOpen]);

  useEffect(() => {
    if (!hoverOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHoverOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hoverOpen]);

  useEffect(() => {
    onUiOpenChange?.(hoverOpen);
  }, [hoverOpen, onUiOpenChange]);

  const stopRow = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="AI context — hover for fields"
        title="AI context"
        className={cn(
          "shrink-0 text-zinc-500 transition-colors hover:text-zinc-300",
          inline
            ? "inline-flex items-center justify-center rounded p-0.5 hover:bg-zinc-800/50"
            : "rounded p-0.5 hover:bg-zinc-800/80",
          filledCount === 0 && "opacity-50"
        )}
        onMouseEnter={openHover}
        onMouseLeave={scheduleCloseHover}
        onClick={(e) => {
          stopRow(e);
          e.preventDefault();
          clearCloseTimer();
          refreshPlacement();
          setHoverOpen((open) => !open);
        }}
        onPointerDown={stopRow}
      >
        <Info
          className={inline ? "h-3 w-3" : "h-3.5 w-3.5"}
          strokeWidth={2}
          aria-hidden
        />
      </button>

      {hoverOpen &&
        placement &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="region"
            aria-label="AI context"
            className="fixed z-[200] w-[min(24rem,calc(100vw-1rem))] max-h-[min(80vh,28rem)] overflow-y-auto rounded-md border border-zinc-600/90 bg-zinc-900 px-3 py-2.5 shadow-xl pointer-events-auto"
            style={{ top: placement.top, left: placement.left }}
            onMouseEnter={() => {
              clearCloseTimer();
            }}
            onMouseLeave={scheduleCloseHover}
            onClick={stopRow}
          >
            {props.variant === "goal" ? (
              <div className="flex flex-col gap-4">
                <div className="min-w-0">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                    Description
                  </p>
                  <InlineEditCell
                    {...GRID_ALIGN}
                    type="textarea"
                    value={props.measurableTarget}
                    onSave={(measurableTarget) =>
                      updateGoal(props.goalId, { measurableTarget })
                    }
                    placeholder="Outcome or metric for this goal"
                    displayClassName="block w-full min-w-0 text-left text-xs leading-normal text-zinc-300"
                  />
                </div>
                <div className="min-w-0">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                    Why
                  </p>
                  <InlineEditCell
                    {...GRID_ALIGN}
                    type="textarea"
                    value={props.whyItMatters}
                    onSave={(whyItMatters) =>
                      updateGoal(props.goalId, { whyItMatters })
                    }
                    placeholder="Why this goal matters — what we stand to gain"
                    displayClassName="block w-full min-w-0 text-left text-xs leading-normal text-zinc-300"
                  />
                </div>
                <div className="min-w-0">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                    Current value
                  </p>
                  <InlineEditCell
                    {...GRID_ALIGN}
                    type="textarea"
                    value={props.currentValue}
                    onSave={(currentValue) =>
                      updateGoal(props.goalId, { currentValue })
                    }
                    placeholder="Progress or value vs the description / target"
                    displayClassName="block w-full min-w-0 text-left text-xs leading-normal text-zinc-300"
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="min-w-0">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                    Description
                  </p>
                  <InlineEditCell
                    {...GRID_ALIGN}
                    type="textarea"
                    value={props.description}
                    onSave={(description) =>
                      updateProject(props.projectId, { description })
                    }
                    placeholder="What this project is delivering"
                    displayClassName="block w-full min-w-0 text-left text-xs leading-normal text-zinc-300"
                  />
                </div>
                <div className="min-w-0">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                    Done when
                  </p>
                  <InlineEditCell
                    {...GRID_ALIGN}
                    type="textarea"
                    value={props.definitionOfDone}
                    onSave={(definitionOfDone) =>
                      updateProject(props.projectId, { definitionOfDone })
                    }
                    placeholder="Definition of done — when this project counts as complete"
                    displayClassName="block w-full min-w-0 text-left text-xs leading-normal text-zinc-300"
                  />
                </div>
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
