/**
 * Small Lucide-style calendar icon for inline use next to date labels in the
 * atlas SVGs (goals, projects, milestones).
 */
export function AtlasCalendarGlyph({
  x,
  y,
  size = 10,
  stroke = "currentColor",
}: {
  x: number;
  y: number;
  size?: number;
  stroke?: string;
}) {
  return (
    <svg
      x={x}
      y={y}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}
