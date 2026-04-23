import {
  formatRelativeCalendarDate,
  getMilestoneDueHorizon,
  type MilestoneDueHorizon,
} from "@/lib/relativeCalendarDate";
import type { LaidMilestone } from "./atlas-types";

interface AtlasMilestoneProps {
  milestone: LaidMilestone;
  /** Show the milestone's name + status (at level 2 or when focused at level 3). */
  showLabel: boolean;
  /** True when this milestone is the current focus target. */
  isFocused: boolean;
  /** True when another milestone is focused — renders faded. */
  isDimmed: boolean;
  /**
   * Current camera scale. Labels are rendered inside a counter-scaled <g> so
   * their on-screen size stays constant regardless of zoom depth. Positional
   * offsets inside that <g> are in on-screen pixels (not SVG units).
   */
  scale: number;
  /**
   * Which side of the bubble gets the milestone NAME. The status line goes
   * on the opposite side. Alternating by arc-index parity prevents adjacent
   * milestones from stacking name-over-name as they march along the arc.
   */
  labelSide: "above" | "below";
  onClick: () => void;
}

/** Break a label into up to `maxLines` lines on word boundaries, ellipsising overflow. */
function wrapLabel(
  label: string,
  maxCharsPerLine: number,
  maxLines: number
): string[] {
  if (!label) return [""];
  const words = label.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  let i = 0;
  for (; i < words.length; i++) {
    const word = words[i]!;
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  // If there is still text we couldn't fit, ellipsise the last line.
  const consumed = lines.join(" ").split(/\s+/).length;
  if (consumed < words.length && lines.length > 0) {
    const last = lines[lines.length - 1]!;
    const room = Math.max(3, maxCharsPerLine - 1);
    lines[lines.length - 1] = `${last.slice(0, room).trimEnd()}…`;
  }
  return lines;
}

/** Short month+day — e.g. "Apr 28". Falls back to the raw ymd if unparseable. */
function formatShortMonthDay(ymd: string): string {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** SVG fill for the bottom status line based on due horizon. */
function horizonFill(horizon: MilestoneDueHorizon, isDone: boolean): string {
  if (isDone) return "#7ba68a";
  switch (horizon) {
    case "overdue":
      return "#f87171";
    case "within24h":
    case "tomorrow":
      return "#fb923c";
    case "soon":
      return "#fbbf24";
    case "this_week":
      return "#facc15";
    case "later":
      return "#a1a1aa";
    case "none":
    default:
      return "#71717a";
  }
}

export function AtlasMilestone({
  milestone,
  showLabel,
  isFocused,
  isDimmed,
  scale,
  labelSide,
  onClick,
}: AtlasMilestoneProps) {
  const m = milestone.milestone;
  const isDone = m.status === "Done";
  const hasDate = m.targetDate.trim().length > 0;
  const horizon: MilestoneDueHorizon = hasDate
    ? getMilestoneDueHorizon(m.targetDate)
    : "none";
  const arcLen = (isDone ? 1 : 0) * (2 * Math.PI * milestone.r * 0.78);

  // Short status: just the relative phrase (in 5d / 2d ago / Done / No date).
  // The absolute date stays on the <title> tooltip and in the milestone
  // panel — the arc only has room for one terse line.
  let statusLabel: string;
  if (isDone) {
    statusLabel = "Done";
  } else if (hasDate) {
    statusLabel = formatRelativeCalendarDate(m.targetDate, new Date(), {
      omitFuturePreposition: false,
    });
  } else {
    statusLabel = "No date";
  }

  const statusColor = horizonFill(horizon, isDone);

  // Inside the counter-scale wrapper, 1 SVG unit = 1 on-screen pixel (the
  // outer camera scale and this inverse scale cancel out). Offsets from
  // (cx, cy) are therefore in screen pixels.
  const inv = 1 / Math.max(scale, 0.0001);
  const onScreenR = milestone.r * scale;
  const nameFont = 11;
  const statusFont = 8;
  const lineGap = 2;
  // Tight wrapping (short lines × 2 lines) so labels for arc-placed milestones
  // don't collide horizontally. Longer names are ellipsised.
  const labelLines = wrapLabel(m.name, 18, 2);

  // Name on `labelSide`, status on the opposite side — alternating parity
  // across the arc prevents adjacent name labels from piling up.
  const nameSide = labelSide;
  const nameBlockHeight = labelLines.length * nameFont + (labelLines.length - 1) * lineGap;
  const nameTopY =
    nameSide === "above"
      ? milestone.cy - onScreenR - 8 - (nameBlockHeight - nameFont)
      : milestone.cy + onScreenR + nameFont + 6;
  const statusY =
    nameSide === "above"
      ? milestone.cy + onScreenR + statusFont + 6
      : milestone.cy - onScreenR - 6;

  return (
    <g
      className="atlas-fade"
      // Interactive only when not already focused — see AtlasProject for
      // the rationale (lets the canvas pan over the focused bubble's area).
      data-atlas-interactive={isFocused ? undefined : "true"}
      style={{
        opacity: isDimmed ? 0.2 : 1,
        cursor: isFocused ? "default" : "pointer",
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (!isFocused) onClick();
      }}
    >
      <title>
        {m.name}
        {hasDate ? ` — due ${formatShortMonthDay(m.targetDate)}` : ""}
      </title>

      <circle
        cx={milestone.cx}
        cy={milestone.cy}
        r={milestone.r}
        fill={milestone.color}
        fillOpacity={isDone ? 0.3 : 0.1}
        stroke={milestone.color}
        strokeWidth={isFocused ? 2 : 1.2}
        vectorEffect="non-scaling-stroke"
      />
      {isDone ? (
        <circle
          cx={milestone.cx}
          cy={milestone.cy}
          r={milestone.r * 0.78}
          fill="none"
          stroke={milestone.color}
          strokeWidth={1}
          strokeDasharray={`${arcLen} 99999`}
          transform={`rotate(-90 ${milestone.cx} ${milestone.cy})`}
          opacity={0.75}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}

      <g
        className="atlas-fade"
        style={{ opacity: showLabel ? 1 : 0, pointerEvents: "none" }}
        transform={`translate(${milestone.cx} ${milestone.cy}) scale(${inv}) translate(${-milestone.cx} ${-milestone.cy})`}
      >
        {labelLines.map((line, i) => (
          <text
            key={i}
            x={milestone.cx}
            y={nameTopY + i * (nameFont + lineGap)}
            textAnchor="middle"
            fontSize={nameFont}
            fill="#f4f4f5"
            fontWeight={500}
          >
            {line}
          </text>
        ))}
        <text
          x={milestone.cx}
          y={statusY}
          textAnchor="middle"
          fontSize={statusFont}
          fill={statusColor}
          letterSpacing={0.4}
          fontWeight={500}
        >
          {statusLabel}
        </text>
      </g>
    </g>
  );
}
