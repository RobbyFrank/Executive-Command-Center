"use client";

import { cn } from "@/lib/utils";

export const SPOTLIGHT_PAD_PX = 8;

export type SlackThreadSpotlightHole = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function readSpotlightHole(
  spotlightEl: HTMLElement | null,
  anchorEl: HTMLElement | null
): SlackThreadSpotlightHole | null {
  const el = spotlightEl ?? anchorEl;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const pad = SPOTLIGHT_PAD_PX;
  return {
    left: Math.max(0, r.left - pad),
    top: Math.max(0, r.top - pad),
    width: r.width + 2 * pad,
    height: r.height + 2 * pad,
  };
}

export function SlackThreadSpotlightBackdrop({
  hole,
  winW,
  winH,
  onDismiss,
  backdropZIndex = 200,
}: {
  hole: SlackThreadSpotlightHole;
  winW: number;
  winH: number;
  onDismiss: () => void;
  /** Dimmed panels sit at this z-index; ring uses +5 (below most modals). */
  backdropZIndex?: number;
}) {
  const left = hole.left;
  const top = hole.top;
  const right = left + hole.width;
  const bottom = top + hole.height;
  const ringZ = backdropZIndex + 5;

  const shade =
    "fixed cursor-default bg-zinc-950/65 backdrop-blur-[3px] motion-reduce:backdrop-blur-none";

  return (
    <>
      {top > 0 ? (
        <div
          className={cn(shade, "left-0 right-0 top-0")}
          style={{ height: top, zIndex: backdropZIndex }}
          onClick={onDismiss}
          aria-hidden
        />
      ) : null}
      {bottom < winH ? (
        <div
          className={cn(shade, "bottom-0 left-0 right-0")}
          style={{ top: bottom, height: winH - bottom, zIndex: backdropZIndex }}
          onClick={onDismiss}
          aria-hidden
        />
      ) : null}
      {left > 0 ? (
        <div
          className={cn(shade, "left-0")}
          style={{
            top,
            width: left,
            height: hole.height,
            zIndex: backdropZIndex,
          }}
          onClick={onDismiss}
          aria-hidden
        />
      ) : null}
      {right < winW ? (
        <div
          className={shade}
          style={{
            top,
            left: right,
            width: winW - right,
            height: hole.height,
            zIndex: backdropZIndex,
          }}
          onClick={onDismiss}
          aria-hidden
        />
      ) : null}
      <div
        className="pointer-events-none fixed rounded-md ring-1 ring-inset ring-white/10"
        style={{
          left,
          top,
          width: hole.width,
          height: hole.height,
          zIndex: ringZ,
        }}
        aria-hidden
      />
    </>
  );
}
