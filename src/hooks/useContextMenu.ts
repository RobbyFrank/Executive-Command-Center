"use client";

import { useCallback, useState, type MouseEvent } from "react";

/** Matches `MENU_MAX_W` in `ContextMenu` — anchor width used to align menus opened from a trigger. */
const MENU_MAX_W = 320;
const MARGIN = 8;

export function useContextMenu() {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  /**
   * Open the same menu as right-click, anchored below a row control (e.g. “…” button).
   */
  const openFromTrigger = useCallback((e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof window === "undefined") return;
    const r = e.currentTarget.getBoundingClientRect();
    const vw = window.innerWidth;
    let left = r.right - MENU_MAX_W;
    if (left < MARGIN) left = MARGIN;
    if (left + MENU_MAX_W > vw - MARGIN) {
      left = Math.max(MARGIN, vw - MENU_MAX_W - MARGIN);
    }
    setPosition({ x: left, y: r.bottom + 4 });
    setOpen(true);
  }, []);

  const onContextMenu = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    // Keep native context menu for text fields (copy/paste); row menu elsewhere.
    if (target?.closest("input, select, textarea, [contenteditable]")) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    setPosition({ x: e.clientX, y: e.clientY });
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  return {
    open,
    x: position.x,
    y: position.y,
    close,
    openFromTrigger,
    onContextMenu,
    /** Use on rows that contain nested buttons so the custom menu wins over the browser menu. */
    onContextMenuCapture: onContextMenu,
  };
}
