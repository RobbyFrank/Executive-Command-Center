import type { Person, Priority } from "@/lib/types/tracker";
import {
  goalStatusColor,
  PRIORITY_COLOR,
  PRIORITY_GLOW_ALPHA,
} from "./atlas-activity";
import { AtlasAvatar } from "./AtlasAvatar";
import type { LaidGoal } from "./atlas-types";

interface AtlasGoalProps {
  goal: LaidGoal;
  /** Optional owner of the goal (resolves to an avatar inside the bubble). */
  owner: Person | undefined;
  /** True when this goal is the current focus target. */
  isFocused: boolean;
  /** True when another goal is focused — renders faded. */
  isDimmed: boolean;
  /**
   * True at level 1 (company zoomed): show all the chrome (description text,
   * project pill, signal markers). At deeper levels, the goal becomes a
   * lightweight focus shell while projects below take over.
   */
  showLabel: boolean;
  /**
   * Current camera scale. Text + chrome use a counter-scaled wrapper so they
   * stay at a fixed on-screen size regardless of zoom depth.
   */
  scale: number;
  onClick: () => void;
}

/** Lucide-style `Layers` glyph — same path used elsewhere in the atlas. */
function SvgLayersIcon({
  x,
  y,
  size,
  stroke = "#a1a1aa",
}: {
  x: number;
  y: number;
  size: number;
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
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" />
      <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
      <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
    </svg>
  );
}

/** Lucide-style filled `Flag` glyph; stroke + fill use the priority color. */
function SvgFlagIcon({
  x,
  y,
  size,
  fill,
  stroke,
}: {
  x: number;
  y: number;
  size: number;
  fill: string;
  stroke: string;
}) {
  return (
    <svg
      x={x}
      y={y}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={stroke}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  );
}

const GOAL_LABEL_MAX_CHARS = 16;
const GOAL_LABEL_MAX_LINES = 3;

function truncate(s: string, max: number): string {
  if (!s) return s;
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Word-wrap a goal description onto up to `maxLines` lines, ellipsising the
 * tail. All-caps text is kept lowercase here — the renderer chooses casing.
 */
function wrapGoalLabel(
  label: string,
  maxChars: number,
  maxLines: number
): string[] {
  const t = label.trim();
  if (t.length === 0) return [""];
  const lines: string[] = [];
  let rest = t;
  while (rest.length > 0 && lines.length < maxLines) {
    if (rest.length <= maxChars) {
      lines.push(rest);
      break;
    }
    const isLast = lines.length === maxLines - 1;
    if (isLast) {
      lines.push(truncate(rest, maxChars));
      break;
    }
    const head = rest.slice(0, maxChars);
    const breakAt = Math.max(
      head.lastIndexOf(" "),
      head.lastIndexOf("/"),
      head.lastIndexOf(":"),
      head.lastIndexOf("-")
    );
    const cut = breakAt > 4 ? breakAt : maxChars;
    lines.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trimStart();
  }
  return lines.length === 0 ? [""] : lines;
}

/**
 * One goal as a freely-floating bubble inside the focused company. Mirrors
 * the iconography language of `AtlasCompany`: priority flag (1 o'clock),
 * status dot (11 o'clock), spotlight spark (top-right), at-risk pulse
 * (bottom-left), italic description center, project-count pill below the
 * disc. A subtle priority-tinted drop-shadow glow makes urgent goals quietly
 * draw the eye even when the user is grouping by something else.
 */
export function AtlasGoal({
  goal,
  owner,
  isFocused,
  isDimmed,
  showLabel,
  scale,
  onClick,
}: AtlasGoalProps) {
  const g = goal.goal;
  const priority = g.priority as Priority;
  const priorityColor = PRIORITY_COLOR[priority] ?? PRIORITY_COLOR.P2;
  const glowAlpha = PRIORITY_GLOW_ALPHA[priority] ?? 0;
  const statusColor = goalStatusColor(g.status);

  const inv = 1 / Math.max(scale, 0.0001);
  const projectCount = goal.projectCount;

  const isClickable = !isFocused;

  // Priority flag + status pip live on the rim of the bubble. We position
  // them in viewBox space (so they scale with the bubble) but render the
  // glyphs inside a counter-scaled `<g>` so their stroke widths and sizes
  // stay constant on screen.
  const flagAngleDeg = -55; // ≈ 1 o'clock
  const flagAngle = (flagAngleDeg * Math.PI) / 180;
  const flagX = goal.cx + Math.cos(flagAngle) * goal.r * 0.92;
  const flagY = goal.cy + Math.sin(flagAngle) * goal.r * 0.92;

  const statusAngleDeg = -125; // ≈ 11 o'clock
  const statusAngle = (statusAngleDeg * Math.PI) / 180;
  const statusX = goal.cx + Math.cos(statusAngle) * goal.r * 0.92;
  const statusY = goal.cy + Math.sin(statusAngle) * goal.r * 0.92;

  const sparkAngleDeg = -38; // ≈ 1–2 o'clock, just outside flag
  const sparkAngle = (sparkAngleDeg * Math.PI) / 180;
  const sparkX = goal.cx + Math.cos(sparkAngle) * goal.r * 1.05;
  const sparkY = goal.cy + Math.sin(sparkAngle) * goal.r * 1.05;
  const sparkSize = Math.max(5, goal.r * 0.16);

  const overdueAngleDeg = 215; // ≈ 7–8 o'clock
  const overdueAngle = (overdueAngleDeg * Math.PI) / 180;
  const overdueX = goal.cx + Math.cos(overdueAngle) * goal.r * 1.02;
  const overdueY = goal.cy + Math.sin(overdueAngle) * goal.r * 1.02;
  const overdueR = Math.max(2.5, goal.r * 0.07);

  const ownerAvatarR = Math.max(7, goal.r * 0.18);
  const ownerAvatarAngleDeg = 130; // ≈ 5 o'clock
  const ownerAvatarAngle = (ownerAvatarAngleDeg * Math.PI) / 180;
  const ownerAvatarX =
    goal.cx + Math.cos(ownerAvatarAngle) * goal.r * 0.7;
  const ownerAvatarY =
    goal.cy + Math.sin(ownerAvatarAngle) * goal.r * 0.7;

  // Counter-scaled overlay for chrome that wants on-screen-pixel sizing.
  // Adapt the description font + line count to the bubble's on-screen size
  // so text never overflows. ~10 px diameter ≈ 1 char per line of room; we
  // cap maxChars/maxLines to keep things readable even at large zooms.
  const onScreenR = goal.r * scale;
  const innerWidthPx = onScreenR * 1.55; // tighter than diameter — sides taper
  const baseFont = Math.max(7.5, Math.min(10.5, onScreenR * 0.18));
  // Approximate width per char for italic 500-weight text.
  const charW = baseFont * 0.55;
  const fitChars = Math.max(8, Math.floor(innerWidthPx / charW));
  const adaptiveMaxChars = Math.min(GOAL_LABEL_MAX_CHARS, fitChars);
  const lineH = baseFont * 1.15;
  const innerHeightPx = onScreenR * 1.4;
  const adaptiveMaxLines = Math.max(
    1,
    Math.min(GOAL_LABEL_MAX_LINES, Math.floor(innerHeightPx / lineH))
  );
  const nameLines = wrapGoalLabel(
    g.description,
    adaptiveMaxChars,
    adaptiveMaxLines
  );
  const nameFontSize = baseFont;
  // Vertically center the name block within the bubble.
  const nameBlockH = nameLines.length * lineH;
  const nameTopY = goal.cy - nameBlockH / 2 + lineH * 0.75;

  // Sanitize composite id (`${companyId}:${goalId}`) for use in SVG id
  // attributes — colons are valid SVG markup but break CSS selectors and
  // cause occasional cross-browser quirks inside `url(#…)`.
  const safeId = goal.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const fillGradientId = `atlas-goal-fill-${safeId}`;
  const showInteractive = !isFocused;

  return (
    <g
      className="atlas-fade"
      data-atlas-interactive={showInteractive ? "true" : undefined}
      style={{
        opacity: isDimmed ? 0.12 : 1,
        cursor: isClickable ? "pointer" : "default",
        filter:
          glowAlpha > 0
            ? `drop-shadow(0 0 ${isFocused ? 12 : 6}px rgba(${hexToRgb(priorityColor)}, ${glowAlpha}))`
            : undefined,
        transition: "filter 600ms ease",
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (isClickable) onClick();
      }}
    >
      <title>
        {g.description}
        {projectCount > 0
          ? ` — ${projectCount} project${projectCount === 1 ? "" : "s"}`
          : ""}
      </title>

      <defs>
        <radialGradient
          id={fillGradientId}
          cx="35%"
          cy="30%"
          r="80%"
          fx="35%"
          fy="30%"
        >
          <stop offset="0%" stopColor="#27272a" stopOpacity={isFocused ? 0.4 : 0.7} />
          <stop offset="65%" stopColor="#18181b" stopOpacity={isFocused ? 0.3 : 0.6} />
          <stop offset="100%" stopColor="#09090b" stopOpacity={isFocused ? 0.2 : 0.55} />
        </radialGradient>
      </defs>

      <circle
        cx={goal.cx}
        cy={goal.cy}
        r={goal.r}
        fill={`url(#${fillGradientId})`}
        stroke={goal.color}
        strokeOpacity={isFocused ? 0.95 : 0.78}
        strokeWidth={isFocused ? 1.8 : 1.3}
        vectorEffect="non-scaling-stroke"
      />
      {/* Faint inner ring tinted with the goal's category color. */}
      <circle
        cx={goal.cx}
        cy={goal.cy}
        r={goal.r}
        fill={goal.color}
        fillOpacity={0.06}
        pointerEvents="none"
      />

      {/* Status pip — small dot at 11 o'clock. */}
      {showLabel ? (
        <g
          pointerEvents="none"
          transform={`translate(${statusX} ${statusY}) scale(${inv}) translate(${-statusX} ${-statusY})`}
        >
          <circle
            cx={statusX}
            cy={statusY}
            r={3.6}
            fill={statusColor}
            fillOpacity={0.95}
            stroke="#09090b"
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
          />
          <title>{g.status}</title>
        </g>
      ) : null}

      {/* Priority flag — 1 o'clock. */}
      {showLabel ? (
        <g
          pointerEvents="none"
          transform={`translate(${flagX} ${flagY}) scale(${inv}) translate(${-flagX} ${-flagY})`}
        >
          <SvgFlagIcon
            x={flagX - 6}
            y={flagY - 6}
            size={12}
            fill={priorityColor}
            stroke={priorityColor}
          />
        </g>
      ) : null}

      {/* Spotlight spark (top-right) — pulses gently. */}
      {showLabel && g.spotlight ? (
        <g
          pointerEvents="none"
          transform={`translate(${sparkX} ${sparkY}) scale(${sparkSize / 3})`}
        >
          <g className="atlas-spark-pulse">
            <path
              d="M 0 -3 L 0.85 -0.85 L 3 0 L 0.85 0.85 L 0 3 L -0.85 0.85 L -3 0 L -0.85 -0.85 Z"
              fill="#fbbf24"
              stroke="#fde68a"
              strokeWidth={0.3}
              style={{ filter: "drop-shadow(0 0 3px rgba(251, 191, 36, 0.7))" }}
            />
          </g>
        </g>
      ) : null}

      {/* At-risk pulse (bottom-left). */}
      {showLabel && g.atRisk ? (
        <g pointerEvents="none">
          <circle
            cx={overdueX}
            cy={overdueY}
            r={overdueR * 1.9}
            fill="#c06a6a"
            fillOpacity={0.18}
            className="atlas-pulse-soft"
          />
          <circle
            cx={overdueX}
            cy={overdueY}
            r={overdueR}
            fill="#ef4444"
            fillOpacity={0.95}
          />
        </g>
      ) : null}

      {/* Italic description, centered in the bubble. */}
      {showLabel ? (
        <g
          pointerEvents="none"
          transform={`translate(${goal.cx} ${goal.cy}) scale(${inv}) translate(${-goal.cx} ${-goal.cy})`}
        >
          <text
            x={goal.cx}
            y={nameTopY}
            textAnchor="middle"
            fontSize={nameFontSize}
            fill="#e4e4e7"
            fontStyle="italic"
            fontWeight={500}
          >
            {nameLines.map((line, i) => (
              <tspan key={i} x={goal.cx} dy={i === 0 ? 0 : lineH}>
                {line}
              </tspan>
            ))}
          </text>
        </g>
      ) : null}

      {/* Project-count pill below the bubble. */}
      {showLabel && projectCount > 0 ? (
        <g
          pointerEvents="none"
          transform={`translate(${goal.cx} ${goal.cy}) scale(${inv}) translate(${-goal.cx} ${-goal.cy})`}
        >
          <g
            transform={`translate(${goal.cx} ${goal.cy + goal.r * scale + 11})`}
          >
            <rect
              x={-22}
              y={-9}
              width={44}
              height={18}
              rx={4}
              fill="#09090b"
              fillOpacity={0.85}
              stroke="#3f3f46"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <SvgLayersIcon x={-15} y={-5} size={10} stroke="#a1a1aa" />
            <text
              x={-2}
              y={0}
              textAnchor="start"
              dominantBaseline="middle"
              fontSize={11}
              fontWeight={600}
              fill="#f4f4f5"
              className="tabular-nums"
            >
              {projectCount}
            </text>
          </g>
        </g>
      ) : null}

      {/* Owner avatar at lower-right inside the bubble. */}
      {showLabel && owner ? (
        <AtlasAvatar
          name={owner.name}
          profilePicturePath={owner.profilePicturePath}
          cx={ownerAvatarX}
          cy={ownerAvatarY}
          r={ownerAvatarR}
          clipId={`atlas-goal-owner-${safeId}`}
        />
      ) : null}

      {/* "Empty" placeholder when the goal has no projects yet — keeps the
          bubble visible but signals there's nothing to drill into. */}
      {showLabel && projectCount === 0 ? (
        <g
          pointerEvents="none"
          transform={`translate(${goal.cx} ${goal.cy}) scale(${inv}) translate(${-goal.cx} ${-goal.cy})`}
        >
          <text
            x={goal.cx}
            y={goal.cy + goal.r * scale + 14}
            textAnchor="middle"
            fontSize={9}
            letterSpacing={1.4}
            fill="#71717a"
            fontWeight={500}
          >
            NO PROJECTS
          </text>
        </g>
      ) : null}
    </g>
  );
}

/**
 * Convert a `#rrggbb` hex string to an `r, g, b` decimal triple (used inside
 * `rgba(...)` for the drop-shadow glow). Falls back to neutral grey if
 * parsing fails.
 */
function hexToRgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "113, 113, 122";
  const n = parseInt(m[1]!, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}
