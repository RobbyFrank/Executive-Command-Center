"use client";

import { useState } from "react";
import {
  formatRelativeCalendarDate,
  getMilestoneDueHorizon,
  type MilestoneDueHorizon,
} from "@/lib/relativeCalendarDate";
import { AtlasCalendarGlyph } from "./AtlasCalendarGlyph";
import type { LaidMilestone } from "./atlas-types";

interface AtlasMilestoneProps {
  milestone: LaidMilestone;
  /**
   * 1-based index — shown at the start of the milestone name (`1. Name`).
   * Computed by the parent from the path order.
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
  asOf: Date;
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

const SHORT_MO = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** Short month+day — e.g. "Apr 28". Fixed English labels so SSR matches the client. */
function formatShortMonthDay(ymd: string): string {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  const mon = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (mon < 0 || mon > 11) return ymd;
  return `${SHORT_MO[mon]} ${d}`;
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
  asOf,
  onClick,
}: AtlasMilestoneProps) {
  const m = milestone.milestone;
  const isDone = m.status === "Done";
  const hasDate = m.targetDate.trim().length > 0;
  const horizon: MilestoneDueHorizon = hasDate
    ? getMilestoneDueHorizon(m.targetDate, asOf)
    : "none";
  const isOverdue = !isDone && horizon === "overdue";
  const arcLen = (isDone ? 1 : 0) * (2 * Math.PI * milestone.r * 0.78);

  let statusLabel: string;
  if (isDone) {
    statusLabel = "Done";
  } else if (hasDate) {
    statusLabel = formatRelativeCalendarDate(m.targetDate, asOf, {
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
  const titleWithIndex = `${sequence}. ${m.name}`;
  const labelLines = wrapLabel(titleWithIndex, 20, 2);

  /** Name always above the bubble; due/status always below (see PortfolioAtlas hints). */
  const nameBlockHeight = labelLines.length * nameFont + (labelLines.length - 1) * lineGap;
  const nameTopY =
    milestone.cy - onScreenR - 8 - (nameBlockHeight - nameFont);
  const statusRowY = milestone.cy + onScreenR + 12;

  // Center status glyph size — sized in viewBox units so it scales with
  // the bubble (intentional: we want it to feel like part of the bubble).
  const glyphSize = milestone.r * 0.95;
  const glyphKind: "done" | "overdue" | "default" = isDone
    ? "done"
    : isOverdue
      ? "overdue"
      : "default";
  const glyphColor = isDone ? "#7ba68a" : isOverdue ? "#f87171" : "#a1a1aa";

  const [hover, setHover] = useState(false);
  const isClickable = !isFocused;
  const isHovering = isClickable && hover;
  const dimOpacity = isDimmed ? (isHovering ? 0.32 : 0.2) : 1;
  const hoverFilter =
    isClickable && isHovering
      ? `drop-shadow(0 0 7px rgba(${hexToRgb(milestone.color)}, 0.32)) drop-shadow(0 0 2px rgba(255, 255, 255, 0.1))`
      : undefined;

  return (
    <g
      className="atlas-fade"
      data-atlas-interactive={isFocused ? undefined : "true"}
      style={{
        opacity: dimOpacity,
        cursor: isClickable ? "pointer" : "default",
        filter: hoverFilter,
        transition: "opacity 200ms ease, filter 200ms ease",
      }}
      onPointerEnter={() => {
        if (isClickable) setHover(true);
      }}
      onPointerLeave={() => setHover(false)}
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
        fillOpacity={isDone ? 0.3 : isHovering ? 0.15 : 0.1}
        stroke={milestone.color}
        strokeWidth={isFocused ? 2 : isHovering ? 1.5 : 1.2}
        vectorEffect="non-scaling-stroke"
        style={{
          transition: "stroke-width 200ms ease, fill-opacity 200ms ease",
        }}
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
        <g transform={`translate(${milestone.cx} ${statusRowY})`} pointerEvents="none">
          {(() => {
            const calSize = 9;
            const iconGap = 4;
            const charW = statusFont * 0.6;
            const textW = statusLabel.length * charW;
            const groupW = calSize + iconGap + textW;
            return (
              <g transform={`translate(${-groupW / 2} 0)`}>
                <g transform="translate(0 1)">
                  <AtlasCalendarGlyph x={0} y={0} size={calSize} stroke={statusColor} />
                </g>
                <text
                  x={calSize + iconGap}
                  y={calSize * 0.5 + 0.5}
                  textAnchor="start"
                  fontSize={statusFont}
                  fill={statusColor}
                  letterSpacing={0.4}
                  fontWeight={500}
                  dominantBaseline="middle"
                >
                  {statusLabel}
                </text>
              </g>
            );
          })()}
        </g>
      </g>
    </g>
  );
}

function hexToRgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "113, 113, 122";
  const n = parseInt(m[1]!, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}
