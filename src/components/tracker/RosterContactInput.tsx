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
          "w-full min-w-0 rounded border border-zinc-700 bg-zinc-900/80 px-2 py-1.5 text-sm text-zinc-200",
          "placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-600",
          error && "border-red-600 focus:ring-red-600"
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
