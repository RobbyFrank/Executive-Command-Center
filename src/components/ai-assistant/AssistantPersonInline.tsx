"use client";

import { displayInitials } from "@/lib/displayInitials";
import { cn } from "@/lib/utils";

export function AssistantPersonInline({
  name,
  profilePicturePath,
  className,
}: {
  name: string;
  profilePicturePath?: string | null;
  className?: string;
}) {
  const photo = profilePicturePath?.trim();
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 align-middle",
        className,
      )}
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt=""
          className="h-5 w-5 shrink-0 rounded-full object-cover ring-1 ring-zinc-600/80"
        />
      ) : (
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[9px] font-semibold text-zinc-300 ring-1 ring-zinc-600/80"
          aria-hidden
        >
          {displayInitials(name)}
        </span>
      )}
      <span className="min-w-0 font-semibold text-zinc-200">{name}</span>
    </span>
  );
}
