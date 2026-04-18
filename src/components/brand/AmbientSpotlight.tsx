"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

export type AmbientSpotlightIntensity = "full" | "subtle" | "ambient";

type Preset = {
  baseGridOpacity: number;
  spotLayerMult: number;
  lineAlpha: number;
  spotRadiusPx: number;
  maskMid: number;
  maskEnd: number;
  washMult: number;
  washSizePx: number;
  gridPx: number;
  colorWash: boolean;
  trackPointer: boolean;
};

const PRESETS: Record<AmbientSpotlightIntensity, Preset> = {
  full: {
    baseGridOpacity: 0.022,
    spotLayerMult: 0.72,
    lineAlpha: 0.35,
    spotRadiusPx: 230,
    maskMid: 0.4,
    maskEnd: 0.78,
    washMult: 0.62,
    washSizePx: 380,
    gridPx: 44,
    colorWash: true,
    trackPointer: true,
  },
  subtle: {
    baseGridOpacity: 0.014,
    spotLayerMult: 0.35,
    lineAlpha: 0.14,
    spotRadiusPx: 180,
    maskMid: 0.38,
    maskEnd: 0.82,
    washMult: 0,
    washSizePx: 0,
    gridPx: 88,
    colorWash: false,
    trackPointer: true,
  },
  ambient: {
    baseGridOpacity: 0.018,
    spotLayerMult: 0.32,
    lineAlpha: 0.2,
    spotRadiusPx: 280,
    maskMid: 0.35,
    maskEnd: 0.85,
    washMult: 0.35,
    washSizePx: 420,
    gridPx: 44,
    colorWash: true,
    trackPointer: false,
  },
};

export function AmbientSpotlight({
  intensity,
  className,
  style,
}: {
  intensity: AmbientSpotlightIntensity;
  className?: string;
  style?: CSSProperties;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const preset = PRESETS[intensity];

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (!preset.trackPointer || reducedMotion) {
      el.style.setProperty("--mx", "50%");
      el.style.setProperty("--my", reducedMotion ? "30%" : "40%");
      el.style.setProperty("--spot-opacity", "1");
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
      const rect = el.getBoundingClientRect();
      pendingX = e.clientX - rect.left;
      pendingY = e.clientY - rect.top;
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

    el.addEventListener("pointermove", handleMove);
    el.addEventListener("pointerenter", handleEnter);
    el.addEventListener("pointerleave", handleLeave);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener("pointermove", handleMove);
      el.removeEventListener("pointerenter", handleEnter);
      el.removeEventListener("pointerleave", handleLeave);
    };
  }, [preset.trackPointer]);

  const gridLine = `rgba(167,243,208,${preset.lineAlpha})`;
  const gridDef = `linear-gradient(to right, ${gridLine} 1px, transparent 1px), linear-gradient(to bottom, ${gridLine} 1px, transparent 1px)`;

  const mask = `radial-gradient(${preset.spotRadiusPx}px circle at var(--mx, 50%) var(--my, 35%), black 0%, rgba(0,0,0,${preset.maskMid}) 42%, transparent ${Math.round(preset.maskEnd * 100)}%)`;

  const washOpacity =
    preset.colorWash && preset.washSizePx > 0
      ? `calc(var(--spot-opacity,1) * ${preset.washMult})`
      : undefined;

  return (
    <div
      ref={rootRef}
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        preset.trackPointer && "pointer-events-auto",
        className
      )}
      style={style}
    >
      <div className="brand-aurora brand-aurora-animate absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full blur-[120px]" />
      <div className="absolute -bottom-32 -left-24 h-[420px] w-[420px] rounded-full bg-violet-500/20 blur-[120px]" />
      <div className="absolute -right-24 top-1/3 h-[360px] w-[360px] rounded-full bg-sky-500/15 blur-[120px]" />

      <div
        className="absolute inset-0"
        style={{
          opacity: preset.baseGridOpacity,
          backgroundImage:
            "linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)",
          backgroundSize: `${preset.gridPx}px ${preset.gridPx}px`,
          maskImage:
            "radial-gradient(ellipse at center, black 40%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, black 40%, transparent 75%)",
        }}
      />

      <div
        className="absolute inset-0 transition-opacity duration-[600ms]"
        style={{
          opacity: `calc(var(--spot-opacity,1) * ${preset.spotLayerMult})`,
          backgroundImage: gridDef,
          backgroundSize: `${preset.gridPx}px ${preset.gridPx}px`,
          maskImage: mask,
          WebkitMaskImage: mask,
        }}
      />

      {preset.colorWash && preset.washSizePx > 0 ? (
        <div
          className="absolute inset-0 mix-blend-screen transition-opacity duration-[600ms]"
          style={{
            opacity: washOpacity,
            background: `radial-gradient(${preset.washSizePx}px circle at var(--mx, 50%) var(--my, 35%), rgba(16,185,129,0.088), rgba(139,92,246,0.044) 40%, transparent 74%)`,
          }}
        />
      ) : null}
    </div>
  );
}
