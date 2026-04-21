"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Options for {@link useSmoothText}.
 */
export interface UseSmoothTextOptions {
  /**
   * Baseline reveal rate in characters per second while the stream is live.
   * Modern AI chat UIs land around 60–100 cps. Default: 80.
   */
  charsPerSecond?: number;
  /**
   * Maximum number of characters we're willing to lag behind the target
   * before we accelerate the reveal. This keeps the typewriter from ever
   * feeling "slow" when the model bursts large tokens, while still
   * smoothing out jitter on small tokens. Default: 400.
   */
  maxBacklog?: number;
  /**
   * How long (ms) to finish revealing any remaining characters once the
   * stream ends (isStreaming goes false). 0 snaps instantly. Default: 250.
   */
  flushMs?: number;
  /**
   * If true, the hook returns `target` unchanged. Useful for force-disabling
   * the effect (the hook already auto-disables when the OS reports
   * prefers-reduced-motion).
   */
  disabled?: boolean;
}

/**
 * Reveals an incoming streamed string at a steady, frame-synced character
 * rate so the UI stops flickering on every server chunk. Pairs naturally
 * with any `fetch` + ReadableStream pipeline where the caller accumulates
 * a full buffer and passes it here as `target`.
 *
 * The hook never goes backwards on its own: if `target` becomes shorter
 * (e.g. the stream was reset), the displayed text instantly snaps to the
 * shorter target so callers can abort/restart without a stale tail.
 *
 * Respects prefers-reduced-motion by falling back to a pass-through.
 */
export function useSmoothText(
  target: string,
  isStreaming: boolean,
  opts: UseSmoothTextOptions = {},
): string {
  const {
    charsPerSecond = 80,
    maxBacklog = 400,
    flushMs = 250,
    disabled = false,
  } = opts;

  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const shortCircuit = disabled || reducedMotion;

  const [displayed, setDisplayed] = useState<string>(shortCircuit ? target : "");

  // Refs mirror state so the rAF loop is stable without restarting on every
  // React render. We re-read them each frame.
  const targetRef = useRef(target);
  const displayedRef = useRef(displayed);
  const isStreamingRef = useRef(isStreaming);
  const optsRef = useRef({ charsPerSecond, maxBacklog, flushMs });
  const lastTickRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);
  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);
  useEffect(() => {
    optsRef.current = { charsPerSecond, maxBacklog, flushMs };
  }, [charsPerSecond, maxBacklog, flushMs]);

  // Fast path: short-circuit just mirrors the target directly.
  useEffect(() => {
    if (!shortCircuit) return;
    displayedRef.current = target;
    setDisplayed(target);
  }, [shortCircuit, target]);

  // If the target got shorter (reset/abort/new turn), snap back so we don't
  // render characters the caller has discarded.
  useEffect(() => {
    if (shortCircuit) return;
    if (target.length < displayedRef.current.length) {
      displayedRef.current = target;
      setDisplayed(target);
    }
  }, [target, shortCircuit]);

  useEffect(() => {
    if (shortCircuit) return;
    if (typeof window === "undefined") return;

    const tick = (now: number) => {
      const prev = lastTickRef.current ?? now;
      const dtSec = Math.max(0, (now - prev) / 1000);
      lastTickRef.current = now;

      const t = targetRef.current;
      const d = displayedRef.current;
      const streaming = isStreamingRef.current;
      const o = optsRef.current;

      if (d.length >= t.length) {
        // Caught up — idle until the next change.
        rafRef.current = null;
        lastTickRef.current = null;
        return;
      }

      const backlog = t.length - d.length;

      // Base speed (cps). If we're lagging past maxBacklog, scale up
      // linearly so we never fall dramatically behind a fast burst.
      let cps = o.charsPerSecond;
      if (backlog > o.maxBacklog) {
        cps = cps * (backlog / o.maxBacklog);
      }

      // When the stream is over, we want to finish everything in flushMs.
      if (!streaming) {
        const flushCps =
          o.flushMs > 0 ? (backlog / o.flushMs) * 1000 : Infinity;
        cps = Math.max(cps, flushCps);
      }

      let step = Math.floor(cps * dtSec);
      // Make sure we always advance at least one char per frame once we're
      // running, otherwise sub-frame rates can stall us.
      if (step < 1) step = 1;
      if (step > backlog) step = backlog;

      const next = t.slice(0, d.length + step);
      displayedRef.current = next;
      setDisplayed(next);

      rafRef.current = window.requestAnimationFrame(tick);
    };

    // Kick the loop whenever we're behind the target (streaming or flushing).
    if (displayedRef.current.length < targetRef.current.length) {
      lastTickRef.current = null;
      rafRef.current = window.requestAnimationFrame(tick);
    }

    return () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastTickRef.current = null;
    };
  }, [shortCircuit, target, isStreaming]);

  return shortCircuit ? target : displayed;
}
