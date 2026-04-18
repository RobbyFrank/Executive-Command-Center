"use client";

import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  kind: "email" | "tel";
  value: string;
  onSave: (next: string) => void;
  validate: (draft: string) => string | undefined;
  className?: string;
};

/**
 * Plain single-line contact field for roster tables (no tooltip / rich edit chrome).
 */
export function RosterContactInput({
  kind,
  value,
  onSave,
  validate,
  className,
}: Props) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | undefined>();
  const hintId = useId();

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    const err = validate(draft);
    if (err) {
      setError(err);
      return;
    }
    setError(undefined);
    const t = draft.trim();
    if (t !== value.trim()) onSave(t);
  };

  const looksFilled = draft.trim().length > 0;

  return (
    <div className={cn("min-w-0", className)}>
      <input
        type={kind}
        autoComplete={kind === "email" ? "email" : "tel"}
        inputMode={kind === "tel" ? "tel" : "email"}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError(undefined);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            setDraft(value);
            setError(undefined);
            e.currentTarget.blur();
          }
        }}
        placeholder={kind === "email" ? "name@company.com" : "+1 …"}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? hintId : undefined}
        className={cn(
          "w-full min-w-0 rounded px-2 py-1.5 text-sm transition-[background-color,border-color,box-shadow] duration-150",
          "placeholder:text-zinc-600 focus:outline-none",
          error
            ? "border border-red-600 bg-zinc-900/80 text-zinc-200 focus:ring-1 focus:ring-red-600"
            : looksFilled
              ? "border border-transparent bg-transparent text-zinc-300 shadow-none hover:border-zinc-700 hover:bg-zinc-900/80 focus:border-zinc-700 focus:bg-zinc-900/80 focus:ring-1 focus:ring-emerald-600"
              : "border border-zinc-700 bg-zinc-900/80 text-zinc-200 focus:border-zinc-600 focus:ring-1 focus:ring-emerald-600"
        )}
      />
      {error ? (
        <p id={hintId} className="mt-0.5 text-[11px] leading-tight text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
