import type { Person } from "@/lib/types/tracker";

interface OwnerSelectDisplayProps {
  people: Person[];
  ownerId: string;
}

/** Collapsed owner cell: photo + department when set; otherwise name with optional department. */
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
  const title = [person.name, dept].filter(Boolean).join(" · ");

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
          className="h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-zinc-700"
        />
        {dept ? (
          <span className="min-w-0 truncate text-[11px] leading-tight text-zinc-400">
            {dept}
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span className="block max-w-full truncate text-left text-sm" title={title}>
      <span className="text-zinc-100">{person.name}</span>
      {dept ? <span className="text-zinc-500"> · {dept}</span> : null}
    </span>
  );
}
