import type { Person } from "@/lib/types/tracker";
import {
  AUTONOMY_GROUP_LABEL,
  clampAutonomy,
  isFounderPerson,
} from "@/lib/autonomyRoster";
import { cn } from "@/lib/utils";

interface OwnerAutonomyBadgeProps {
  person: Person;
  /** Pixel-tier preset; `sm` is sized for the 24px avatar in the Roadmap owner column. */
  size?: "sm" | "md";
  /**
   * Border colour fed by the parent surface (matches the row chrome) so the badge
   * cleanly separates from the avatar even on busy backgrounds.
   */
  ringClassName?: string;
  className?: string;
}

/**
 * Tiny corner badge denoting the owner's autonomy:
 *   • Founders → gold crown (♛)
 *   • Level 0 (not assessed) → "?"
 *   • Levels 1–5 → digit, colored by band (amber 1–2, zinc 3, emerald 4–5).
 *
 * Designed to be absolutely positioned by a `relative` parent (e.g. anchored to
 * the bottom-right of an avatar img). The colour bands intentionally mirror the
 * `A{n}` pills used inside the owner picker so users see the same signal in
 * both surfaces.
 */
export function OwnerAutonomyBadge({
  person,
  size = "sm",
  ringClassName = "ring-zinc-900",
  className,
}: OwnerAutonomyBadgeProps) {
  const founder = isFounderPerson(person);
  const level = clampAutonomy(person.autonomyScore);

  const dims =
    size === "sm"
      ? "h-4 w-4 min-h-4 min-w-4 text-[10px]"
      : "h-[18px] w-[18px] min-h-[18px] min-w-[18px] text-[11px]";

  let palette: string;
  let glyph: string;
  let title: string;

  if (founder) {
    palette = "bg-amber-600 text-white";
    glyph = "\u265B";
    title = "Founder";
  } else if (level === 0) {
    palette = "bg-zinc-600 text-white";
    glyph = "?";
    title = `Autonomy ${AUTONOMY_GROUP_LABEL[0].title}`;
  } else if (level >= 4) {
    palette = "bg-emerald-600 text-white";
    glyph = String(level);
    title = `Autonomy ${AUTONOMY_GROUP_LABEL[level].title}`;
  } else if (level === 3) {
    palette = "bg-zinc-600 text-white";
    glyph = String(level);
    title = `Autonomy ${AUTONOMY_GROUP_LABEL[3].title}`;
  } else {
    palette = "bg-amber-600 text-white";
    glyph = String(level);
    title = `Autonomy ${AUTONOMY_GROUP_LABEL[level].title}`;
  }

  return (
    <span
      className={cn(
        "pointer-events-none absolute -bottom-[3px] -right-[12px] inline-flex items-center justify-center rounded-full font-bold tabular-nums leading-none shadow-sm ring-2",
        dims,
        palette,
        ringClassName,
        className,
      )}
      aria-label={title}
      title={title}
    >
      <span aria-hidden>{glyph}</span>
    </span>
  );
}
