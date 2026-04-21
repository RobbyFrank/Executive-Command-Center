"use client";

import { useEffect, useRef } from "react";

/**
 * Fixed, full-viewport ambient background for the dashboard.
 *
 * Layers (back → front):
 *   1. Deep slate base (radial gradient toward the top-center).
 *   2. Static brand aurora blobs (emerald / violet / sky) — same as before, slightly calmer.
 *   3. Faint base grid (no color), gently vignetted so edges stay calm.
 *   4. Pointer-tracked spotlight grid — same mechanism as the Login page but
 *      dialed way down (lower alpha, larger radius) so dense tracker UI still reads.
 *   5. A very subtle emerald wash under the cursor, also vignetted.
 *   6. Soft top-edge vignette to separate sticky toolbar from the page below.
 *
 * Rendered once in the dashboard layout; content sits on top at `z-10`.
 */
export function DashboardAmbientBackground() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    // Reduced motion / touch-only: park the spotlight centered and don't track the pointer.
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion) {
      el.style.setProperty("--mx", "50%");
      el.style.setProperty("--my", "30%");
      el.style.setProperty("--spot-opacity", "0.6");
      return;
    }

    let frame = 0;
    let pendingX = 0;
    let pendingY = 0;

    const flush = () => {
      frame = 0;
      el.style.setProperty("--mx", `${pendingX}px`);
      el.style.setProperty("--my", `${pendingY}px`);
    };

    const handleMove = (e: PointerEvent) => {
      pendingX = e.clientX;
      pendingY = e.clientY;
      if (!frame) frame = requestAnimationFrame(flush);
    };

    const handleEnter = () => {
      el.style.setProperty("--spot-opacity", "1");
    };
    const handleLeave = () => {
      el.style.setProperty("--spot-opacity", "0");
    };

    el.style.setProperty("--mx", "50%");
    el.style.setProperty("--my", "35%");
    el.style.setProperty("--spot-opacity", "1");

    window.addEventListener("pointermove", handleMove, { passive: true });
    window.addEventListener("pointerenter", handleEnter);
    window.addEventListener("pointerleave", handleLeave);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerenter", handleEnter);
      window.removeEventListener("pointerleave", handleLeave);
    };
  }, []);

  // Whisper-quiet spotlight — noticeable when you look for it, invisible when
  // you're reading dense tracker rows. Roughly 1/4 the intensity of Login.
  const spotRadiusPx = 360;
  const washRadiusPx = 500;
  const spotLineAlpha = 0.07;
  const spotLayerMult = 0.28;
  const washMult = 0.22;
  const gridPx = 44;

  const gridLine = `rgba(167,243,208,${spotLineAlpha})`;
  const spotGrid = `linear-gradient(to right, ${gridLine} 1px, transparent 1px), linear-gradient(to bottom, ${gridLine} 1px, transparent 1px)`;
  const spotMask = `radial-gradient(${spotRadiusPx}px circle at var(--mx, 50%) var(--my, 35%), black 0%, rgba(0,0,0,0.4) 48%, transparent 82%)`;

  return (
    <div
      ref={rootRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      {/* 1. Deep slate base */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_120%_90%_at_50%_0%,#0d0e14_0%,#080910_50%,#050508_100%)]" />

      {/* 2. Static brand aurora blobs */}
      <div className="absolute -top-48 left-1/2 h-[620px] w-[620px] -translate-x-1/2 rounded-full bg-emerald-500/[0.045] blur-[140px]" />
      <div className="absolute -bottom-40 -left-24 h-[520px] w-[520px] rounded-full bg-violet-500/[0.04] blur-[140px]" />
      <div className="absolute -right-32 top-1/4 h-[460px] w-[460px] rounded-full bg-sky-500/[0.028] blur-[140px]" />

      {/* 3. Faint base grid — restored to the original calm look */}
      <div
        className="absolute inset-0 opacity-[0.018]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)",
          backgroundSize: `${gridPx}px ${gridPx}px`,
          maskImage:
            "radial-gradient(ellipse at center, black 35%, transparent 80%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, black 35%, transparent 80%)",
        }}
      />

      {/* 4. Pointer-tracked spotlight grid */}
      <div
        className="absolute inset-0 transition-opacity duration-[600ms]"
        style={{
          opacity: `calc(var(--spot-opacity, 1) * ${spotLayerMult})`,
          backgroundImage: spotGrid,
          backgroundSize: `${gridPx}px ${gridPx}px`,
          maskImage: spotMask,
          WebkitMaskImage: spotMask,
        }}
      />

      {/* 5. Very faint emerald wash under the cursor */}
      <div
        className="absolute inset-0 mix-blend-screen transition-opacity duration-[600ms]"
        style={{
          opacity: `calc(var(--spot-opacity, 1) * ${washMult})`,
          background: `radial-gradient(${washRadiusPx}px circle at var(--mx, 50%) var(--my, 35%), rgba(16,185,129,0.03), rgba(139,92,246,0.015) 42%, transparent 78%)`,
        }}
      />

      {/* 6. Top-edge vignette to separate sticky header from page */}
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/30 to-transparent" />
    </div>
  );
}
