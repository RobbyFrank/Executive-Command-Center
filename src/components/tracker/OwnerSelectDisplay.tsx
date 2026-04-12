import type { Person } from "@/lib/types/tracker";
import { firstNameFromFullName } from "@/lib/personDisplayName";
import { clampAutonomy, isFounderPerson } from "@/lib/autonomyRoster";
import { cn } from "@/lib/utils";

interface OwnerSelectDisplayProps {
  people: Person[];
  ownerId: string;
}

/** Collapsed owner cell: photo + first name when set; otherwise name with optional department. */
export function OwnerSelectDisplay({ people, ownerId }: OwnerSelectDisplayProps) {
  const person = people.find((p) => p.id === ownerId);
  if (!person) {
    return (
      <span className="text-zinc-500 text-xs truncate block max-w-full" title={ownerId}>
        Unknown
      </span>
    );
  }
  const path = person.profilePicturePath?.trim();
  const dept = person.department?.trim();
  const displayName = firstNameFromFullName(person.name);
  const title = [person.name, dept].filter(Boolean).join(" · ");
  const autonomyRing =
    !isFounderPerson(person) && clampAutonomy(person.autonomyScore) <= 2;

  if (path) {
    return (
      <span
        className="inline-flex min-w-0 max-w-full items-center gap-1.5"
        title={title}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={path}
          alt=""
          className={cn(
            "h-6 w-6 shrink-0 rounded-full object-cover ring-2",
            autonomyRing
              ? "ring-amber-500/75"
              : "ring-zinc-700"
          )}
        />
        {displayName ? (
          <span className="min-w-0 truncate text-[11px] leading-tight text-zinc-100">
            {displayName}
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span className="block max-w-full truncate text-left text-sm" title={title}>
      <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
        {autonomyRing ? (
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-amber-500/90 ring-1 ring-amber-400/50"
            aria-hidden
          />
        ) : null}
        <span className="min-w-0 truncate">
          <span className="text-zinc-100">{displayName}</span>
          {dept ? <span className="text-zinc-500"> · {dept}</span> : null}
        </span>
      </span>
    </span>
  );
}
