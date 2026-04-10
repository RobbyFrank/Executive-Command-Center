"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { loginAction, type LoginState } from "@/server/actions/auth";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-md transition-colors"
    >
      {pending ? "Signing in..." : "Sign In"}
    </button>
  );
}

export default function LoginPage() {
  const [state, formAction] = useActionState<LoginState | null, FormData>(
    loginAction,
    null
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <div className="w-full max-w-sm p-8 space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-zinc-100">
            Executive Command Center
          </h1>
          <p className="text-sm text-zinc-500">Roadmap</p>
        </div>

        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="username"
              className="text-sm font-medium text-zinc-300"
            >
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              required
              autoFocus
              autoComplete="username"
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-md text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
              placeholder="Enter username"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="password"
              className="text-sm font-medium text-zinc-300"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-md text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
              placeholder="Enter passphrase"
            />
          </div>

          {state?.error && (
            <p className="text-sm text-red-400">{state.error}</p>
          )}

          <SubmitButton />
        </form>
      </div>
    </div>
  );
}
