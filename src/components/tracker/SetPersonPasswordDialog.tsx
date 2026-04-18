"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setPersonPassword } from "@/server/actions/auth-admin";
import type { Person } from "@/lib/types/tracker";

type PersonWithLogin = Person & { loginPasswordSet?: boolean };

export function SetPersonPasswordDialog({
  open,
  onClose,
  person,
  mode,
}: {
  open: boolean;
  onClose: () => void;
  person: PersonWithLogin;
  mode: "set" | "change";
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  if (!open) return null;

  const title =
    mode === "set" ? `Set login password — ${person.name}` : `Change password — ${person.name}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="set-pwd-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setPassword("");
          onClose();
        }
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-5 shadow-xl">
        <h2 id="set-pwd-title" className="text-lg font-semibold text-zinc-100">
          {title}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Sign in with <span className="font-medium text-zinc-400">{person.email}</span> and this
          password. Minimum 8 characters.
        </p>
        <label htmlFor="set-pwd-field" className="mt-4 block text-sm font-medium text-zinc-300">
          New password
        </label>
        <input
          id="set-pwd-field"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/80"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            disabled={pending}
            onClick={() => {
              setPassword("");
              onClose();
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            disabled={pending}
            onClick={async () => {
              const p = password.trim();
              if (p.length < 8) {
                toast.error("Password must be at least 8 characters.");
                return;
              }
              setPending(true);
              try {
                const r = await setPersonPassword(person.id, p);
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                toast.success(mode === "set" ? "Password saved." : "Password updated.");
                setPassword("");
                onClose();
                router.refresh();
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
