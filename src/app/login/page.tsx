"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Image from "next/image";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { loginAction, type LoginState } from "@/server/actions/auth";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="group relative mt-2 inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-lg bg-gradient-to-b from-emerald-500 to-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_1px_0_0_rgba(255,255,255,0.15)_inset,0_8px_24px_-8px_rgba(16,185,129,0.55)] ring-1 ring-emerald-400/30 transition-all hover:from-emerald-400 hover:to-emerald-500 hover:shadow-[0_1px_0_0_rgba(255,255,255,0.2)_inset,0_10px_32px_-8px_rgba(16,185,129,0.7)] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full"
      />
      <span className="relative flex items-center gap-2">
        {pending ? "Signing in…" : "Sign in"}
        {!pending && (
          <ArrowRight
            className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        )}
      </span>
    </button>
  );
}

export default function LoginPage() {
  const [state, formAction] = useActionState<LoginState | null, FormData>(
    loginAction,
    null
  );
  const [showPassword, setShowPassword] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Pointer-tracked spotlight. We update CSS variables on the root element via
  // rAF so React never re-renders on mousemove — keeps the effect buttery smooth.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      // Park the spotlight at the top-center for a pleasant static look.
      el.style.setProperty("--mx", "50%");
      el.style.setProperty("--my", "30%");
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

    // Initial park position so the spotlight has somewhere to live before the
    // user moves the mouse (avoids a flash at 0,0).
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
  }, []);

  return (
    <div
      ref={rootRef}
      className="relative flex min-h-full w-full flex-col items-center justify-center overflow-y-auto bg-zinc-950 px-4 py-12"
    >
      {/* Ambient background: aurora blobs + subtle grid + mouse spotlight */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        {/* Soft aurora blobs */}
        <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-emerald-500/20 blur-[120px]" />
        <div className="absolute -bottom-32 -left-24 h-[420px] w-[420px] rounded-full bg-violet-500/20 blur-[120px]" />
        <div className="absolute -right-24 top-1/3 h-[360px] w-[360px] rounded-full bg-sky-500/15 blur-[120px]" />

        {/* Base grid — faint global texture */}
        <div
          className="absolute inset-0 opacity-[0.022]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage:
              "radial-gradient(ellipse at center, black 40%, transparent 75%)",
            WebkitMaskImage:
              "radial-gradient(ellipse at center, black 40%, transparent 75%)",
          }}
        />

        {/* Spotlight grid — mid-strength lines, follows cursor */}
        <div
          className="absolute inset-0 opacity-[calc(var(--spot-opacity,0)*0.72)] transition-opacity duration-[600ms]"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(167,243,208,0.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(167,243,208,0.35) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage:
              "radial-gradient(230px circle at var(--mx, 50%) var(--my, 35%), black 0%, rgba(0,0,0,0.4) 42%, transparent 78%)",
            WebkitMaskImage:
              "radial-gradient(230px circle at var(--mx, 50%) var(--my, 35%), black 0%, rgba(0,0,0,0.4) 42%, transparent 78%)",
          }}
        />

        {/* Color lift — balanced brand tint under the cursor */}
        <div
          className="absolute inset-0 opacity-[calc(var(--spot-opacity,0)*0.62)] mix-blend-screen transition-opacity duration-[600ms]"
          style={{
            background:
              "radial-gradient(380px circle at var(--mx, 50%) var(--my, 35%), rgba(16,185,129,0.088), rgba(139,92,246,0.044) 40%, transparent 74%)",
          }}
        />
      </div>

      <div className="relative w-full max-w-md">
        {/* Gradient border wrapper */}
        <div className="relative rounded-2xl bg-gradient-to-b from-white/10 via-white/5 to-white/0 p-px shadow-2xl shadow-black/40">
          <div className="relative rounded-[15px] bg-zinc-950/80 p-8 backdrop-blur-xl">
            {/* Brand */}
            <div className="mb-8 flex flex-col items-center text-center">
              <div className="relative mb-4 flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl">
                <Image
                  src="/icons/icon.png"
                  alt=""
                  width={48}
                  height={48}
                  className="h-full w-full object-contain"
                  priority
                />
              </div>
              <h1 className="bg-gradient-to-b from-white to-zinc-400 bg-clip-text text-2xl font-semibold tracking-tight text-transparent">
                Portfolio OS
              </h1>
              <p className="mt-1.5 text-sm text-zinc-500">
                Sign in to access the MLabs Portfolio
              </p>
            </div>

            <form action={formAction} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="email"
                  className="block text-xs font-medium uppercase tracking-wider text-zinc-400"
                >
                  Email
                </label>
                <div className="group relative">
                  <Mail
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500 transition-colors group-focus-within:text-emerald-400"
                    aria-hidden
                  />
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoFocus
                    autoComplete="email"
                    className="w-full rounded-lg border border-zinc-800/80 bg-zinc-900/60 py-2.5 pl-10 pr-3 text-sm text-zinc-100 placeholder-zinc-600 shadow-inner shadow-black/20 transition-all focus:border-emerald-500/60 focus:bg-zinc-900/90 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    placeholder="you@company.com"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="password"
                  className="block text-xs font-medium uppercase tracking-wider text-zinc-400"
                >
                  Password
                </label>
                <div className="group relative">
                  <Lock
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500 transition-colors group-focus-within:text-emerald-400"
                    aria-hidden
                  />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    className="w-full rounded-lg border border-zinc-800/80 bg-zinc-900/60 py-2.5 pl-10 pr-11 text-sm text-zinc-100 placeholder-zinc-600 shadow-inner shadow-black/20 transition-all focus:border-emerald-500/60 focus:bg-zinc-900/90 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    placeholder="Enter passphrase"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden />
                    )}
                  </button>
                </div>
              </div>

              {state?.error ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300"
                >
                  <span
                    aria-hidden
                    className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-red-400"
                  />
                  <span>{state.error}</span>
                </div>
              ) : null}

              <SubmitButton />
            </form>

            <div className="mt-6 flex items-center justify-center gap-2 text-xs text-zinc-500">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500/80" aria-hidden />
              Secured session · Authorized personnel only
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-zinc-600">
          © {new Date().getFullYear()} MLabs · Portfolio OS
        </p>
      </div>
    </div>
  );
}
