import {
  formatRelativeCalendarDate,
  getMilestoneDueHorizon,
  type MilestoneDueHorizon,
} from "@/lib/relativeCalendarDate";
import type { LaidMilestone } from "./atlas-types";

interface AtlasMilestoneProps {
  milestone: LaidMilestone;
  /**
   * 1-based chronological index used for the sequence badge above the
   * bubble. Computed by the parent (`PortfolioAtlas`) from the
   * `positionMilestones` order so it stays consistent with the wandering
   * path layout.
   */
  sequence: number;
  /** Show the milestone's name + status (at level 3, or when focused at level 4). */
  showLabel: boolean;
  /** True when this milestone is the current focus target. */
  isFocused: boolean;
  /** True when another milestone is focused — renders faded. */
  isDimmed: boolean;
  /**
   * Current camera scale. Labels are rendered inside a counter-scaled `<g>`
   * so their on-screen size stays constant regardless of zoom depth.
   */
  scale: number;
  /**
   * Which side of the bubble gets the milestone NAME. The status line goes
   * on the opposite side. Alternating by index parity prevents adjacent
   * milestones' name blocks from stacking name-over-name.
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

/** Inline check (Done) / hourglass (overdue) / dot (in-flight) glyphs. */
function MilestoneStatusGlyph({
  cx,
  cy,
  size,
  kind,
  color,
}: {
  cx: number;
  cy: number;
  size: number;
  kind: "done" | "overdue" | "default";
  color: string;
}) {
  const x = cx - size / 2;
  const y = cy - size / 2;
  const common = {
    x,
    y,
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: color,
    strokeWidth: 2.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (kind === "done") {
    return (
      <svg {...common}>
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (kind === "overdue") {
    return (
      <svg {...common}>
        <path d="M5 22h14" />
        <path d="M5 2h14" />
        <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
        <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
      </svg>
    );
  }
  return (
    <svg {...common} fill={color} stroke={color}>
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function AtlasMilestone({
  milestone,
  sequence,
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
  const isOverdue = !isDone && horizon === "overdue";
  const arcLen = (isDone ? 1 : 0) * (2 * Math.PI * milestone.r * 0.78);

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

  const inv = 1 / Math.max(scale, 0.0001);
  const onScreenR = milestone.r * scale;
  const nameFont = 11;
  const statusFont = 8;
  const lineGap = 2;
  const labelLines = wrapLabel(m.name, 18, 2);

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

  // Sequence badge — small numbered chip above the bubble (regardless of
  // which side the name label sits on, the sequence stays at the top so it
  // reads naturally left-to-right along the path).
  const badgeR = 8;
  const badgeOffsetY = -onScreenR - badgeR - 2;

  // Center status glyph size — sized in viewBox units so it scales with
  // the bubble (intentional: we want it to feel like part of the bubble).
  const glyphSize = milestone.r * 0.95;
  const glyphKind: "done" | "overdue" | "default" = isDone
    ? "done"
    : isOverdue
      ? "overdue"
      : "default";
  const glyphColor = isDone ? "#7ba68a" : isOverdue ? "#f87171" : "#a1a1aa";

  return (
    <g
      className="atlas-fade"
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
        {`${sequence}. ${m.name}`}
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
          pointerEvents="none"
        />
      ) : null}

      {/* Status glyph centered (sized in viewBox space, scales with bubble). */}
      <g pointerEvents="none">
        <MilestoneStatusGlyph
          cx={milestone.cx}
          cy={milestone.cy}
          size={glyphSize}
          kind={glyphKind}
          color={glyphColor}
        />
      </g>

      {/* Sequence badge — sits above the bubble, counter-scaled. */}
      <g
        pointerEvents="none"
        transform={`translate(${milestone.cx} ${milestone.cy}) scale(${inv}) translate(${-milestone.cx} ${-milestone.cy})`}
      >
        <g transform={`translate(${milestone.cx} ${milestone.cy + badgeOffsetY})`}>
          <circle
            cx={0}
            cy={0}
            r={badgeR}
            fill="#09090b"
            stroke={milestone.color}
            strokeOpacity={0.9}
            strokeWidth={1.3}
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={0}
            y={0}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={9.5}
            fontWeight={700}
            fill="#f4f4f5"
            className="tabular-nums"
          >
            {sequence}
          </text>
        </g>
      </g>

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
