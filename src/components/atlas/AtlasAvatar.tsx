import { displayInitials } from "@/lib/displayInitials";

interface AtlasAvatarProps {
  name: string;
  profilePicturePath?: string;
  cx: number;
  cy: number;
  r: number;
  /** Unique id for the SVG clip-path (must be unique across the document). */
  clipId: string;
}

/**
 * Circular avatar rendered inside SVG. Falls back to initials on an emerald
 * tint (matching the rest of the dark UI) when no image path is provided.
 */
export function AtlasAvatar({
  name,
  profilePicturePath,
  cx,
  cy,
  r,
  clipId,
}: AtlasAvatarProps) {
  const hasImage = Boolean(profilePicturePath?.trim());
  const initials = displayInitials(name || "?");

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill="#18181b" />
      {hasImage ? (
        <image
          href={profilePicturePath}
          x={cx - r}
          y={cy - r}
          width={r * 2}
          height={r * 2}
          clipPath={`url(#${clipId})`}
          preserveAspectRatio="xMidYMid slice"
        />
      ) : (
        <text
          x={cx}
          y={cy + r * 0.35}
          textAnchor="middle"
          fontSize={r}
          fill="#a1a1aa"
          fontWeight={600}
          style={{ pointerEvents: "none" }}
        >
          {initials}
        </text>
      )}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="#3f3f46"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}
