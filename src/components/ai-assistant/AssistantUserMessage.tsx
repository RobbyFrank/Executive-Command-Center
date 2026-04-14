"use client";

import { ECC_MENTION_RE_GLOBAL } from "@/lib/assistantMentions";
import { cn } from "@/lib/utils";

function chipClass(type: string): string {
  switch (type) {
    case "company":
      return "border-sky-700/50 bg-sky-950/50 text-sky-100";
    case "goal":
      return "border-emerald-700/50 bg-emerald-950/40 text-emerald-100";
    case "project":
      return "border-amber-700/50 bg-amber-950/40 text-amber-100";
    case "milestone":
      return "border-violet-700/50 bg-violet-950/40 text-violet-100";
    default:
      return "border-zinc-600 bg-zinc-800 text-zinc-200";
  }
}

function typePrefix(type: string): string {
  switch (type) {
    case "company":
      return "Company";
    case "goal":
      return "Goal";
    case "project":
      return "Project";
    case "milestone":
      return "Milestone";
    default:
      return type;
  }
}

export function AssistantUserMessage({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const re = new RegExp(ECC_MENTION_RE_GLOBAL.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(<span key={`t-${key++}`}>{text.slice(last, m.index)}</span>);
    }
    const label = m[1];
    const entType = m[2];
    parts.push(
      <span
        key={`m-${m[3]}-${m.index}`}
        className={cn(
          "inline-flex max-w-full items-baseline gap-1 rounded border px-1.5 py-0.5 align-baseline text-[0.92em] font-medium",
          chipClass(entType),
        )}
        title={`${typePrefix(entType)} · ${label}`}
      >
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide opacity-80">
          {typePrefix(entType)}
        </span>
        <span className="min-w-0 break-words">{label}</span>
      </span>,
    );
    last = re.lastIndex;
  }
  if (last < text.length) {
    parts.push(<span key={`t-${key++}`}>{text.slice(last)}</span>);
  }

  return (
    <span className="whitespace-pre-wrap break-words [word-break:break-word]">
      {parts}
    </span>
  );
}
