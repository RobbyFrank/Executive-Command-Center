"use client";

import { useCallback, useState, type MouseEvent } from "react";

export function useContextMenu() {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

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
    onContextMenu,
    /** Use on rows that contain nested buttons so the custom menu wins over the browser menu. */
    onContextMenuCapture: onContextMenu,
  };
}
