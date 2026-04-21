"use client";

import { useEffect, useId, useState } from "react";
import { Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizePersonEmail } from "@/lib/personContactValidation";

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
  const [draft, setDraft] = useState(() =>
    kind === "email" ? normalizePersonEmail(value) : value
  );
  const [error, setError] = useState<string | undefined>();
  const hintId = useId();

  useEffect(() => {
    setDraft(kind === "email" ? normalizePersonEmail(value) : value);
  }, [value, kind]);

  const commit = () => {
    const err = validate(draft);
    if (err) {
      setError(err);
      return;
    }
    setError(undefined);
    const t = kind === "email" ? normalizePersonEmail(draft) : draft.trim();
    const prev =
      kind === "email" ? normalizePersonEmail(value) : value.trim();
    if (t !== prev) onSave(t);
    if (kind === "email" && draft !== t) setDraft(t);
  };

  const looksFilled =
    (kind === "email" ? normalizePersonEmail(draft) : draft.trim()).length > 0;

  const showTelHintIcon =
    kind === "tel" && !looksFilled && !error;

  return (
    <div className={cn("relative min-w-0", className)}>
      {showTelHintIcon ? (
        <Phone
          className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500/65"
          strokeWidth={1.5}
          aria-hidden
        />
      ) : null}
      <input
        type={kind}
        autoComplete={kind === "email" ? "email" : "tel"}
        inputMode={kind === "tel" ? "tel" : "email"}
        value={draft}
        onChange={(e) => {
          setDraft(
            kind === "email"
              ? e.target.value.toLowerCase()
              : e.target.value
          );
          if (error) setError(undefined);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            setDraft(kind === "email" ? normalizePersonEmail(value) : value);
            setError(undefined);
            e.currentTarget.blur();
          }
        }}
        placeholder={kind === "email" ? "name@company.com" : undefined}
        aria-label={kind === "tel" ? "Phone number" : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? hintId : undefined}
        className={cn(
          "w-full min-w-0 rounded py-1.5 text-sm transition-[background-color,border-color,box-shadow] duration-150",
          showTelHintIcon ? "pl-7 pr-2" : "px-2",
          "placeholder:text-zinc-600 focus:outline-none",
          error
            ? "border border-red-600 bg-zinc-900/80 text-zinc-200 focus:ring-1 focus:ring-red-600"
            : looksFilled
              ? "border border-transparent bg-transparent text-zinc-300 shadow-none hover:border-zinc-700 hover:bg-zinc-900/80 focus:border-zinc-700 focus:bg-zinc-900/80 focus:ring-1 focus:ring-emerald-600"
              : "border border-transparent bg-transparent text-zinc-200 shadow-none hover:border-zinc-700 hover:bg-zinc-900/80 focus:border-zinc-600 focus:bg-zinc-900/80 focus:ring-1 focus:ring-emerald-600"
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
