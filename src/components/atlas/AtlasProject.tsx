"use client";

import {
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  formatRelativeCalendarDate,
  getMilestoneDueHorizon,
  type MilestoneDueHorizon,
} from "@/lib/relativeCalendarDate";
import type {
  Milestone,
  Person,
  Priority,
  ProjectType,
} from "@/lib/types/tracker";
import {
  PRIORITY_COLOR,
  PRIORITY_GLOW_ALPHA,
  projectStatusStrokeColor,
} from "./atlas-activity";
import { AtlasAvatar } from "./AtlasAvatar";
import { AtlasCalendarGlyph } from "./AtlasCalendarGlyph";
import { AtlasMilestonePipTip } from "./AtlasMilestonePipTip";
import type { LaidProject } from "./atlas-types";

interface AtlasProjectProps {
  project: LaidProject;
  owner: Person | undefined;
  /**
   * Show the full label block (name + meta). Used at level 2 (focused goal)
   * where projects float in the ether and there is room beside each bubble.
   */
  showLabel: boolean;
  /** True when this project is the focused one (level 3+). */
  isFocused: boolean;
  /** True when another project in the same goal is focused — renders faded. */
  isDimmed: boolean;
  /**
   * Current camera scale. Text + chrome are wrapped in a counter-scaled
   * `<g>` so they stay at a fixed on-screen size regardless of zoom depth.
   */
  scale: number;
  asOfYmd: string;
  asOf: Date;
  onClick: () => void;
  /**
   * Click a milestone pip on the rim — opens that milestone’s Slack-thread
   * popover (same as Roadmap). `milestoneId` identifies which pip was
   * clicked; `rect` is the screen-space box for popover anchoring.
   */
  onMilestoneStatusClick?: (
    projectId: string,
    milestoneId: string,
    rect: { left: number; top: number; width: number; height: number }
  ) => void;
}

function truncate(s: string, max: number): string {
  if (!s) return s;
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Word-wrap a label onto up to `maxLines` lines (≤ `maxChars` each). */
function wrapLabel(
  label: string,
  maxChars: number,
  maxLines: number
): string[] {
  if (!label) return [""];
  const words = label.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  const used = lines.join(" ");
  if (used.length < label.length && lines.length > 0) {
    const last = lines[lines.length - 1]!;
    lines[lines.length - 1] = truncate(last, maxChars);
  }
  return lines;
}

/** Lucide-style filled `Flag` glyph (priority cue). */
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

/**
 * Inline SVG glyph per `ProjectType`. Same lucide vocabulary used elsewhere
 * in the app for consistency: Engineering = code-2, Product = box, Sales =
 * trending-up, Strategic = compass, Operations = settings, Hiring =
 * user-plus, Marketing = megaphone.
 */
function ProjectTypeGlyph({
  type,
  cx,
  cy,
  size,
  stroke,
}: {
  type: ProjectType;
  cx: number;
  cy: number;
  size: number;
  stroke: string;
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
    stroke,
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (type) {
    case "Engineering":
      return (
        <svg {...common}>
          <polyline points="18 16 22 12 18 8" />
          <polyline points="6 8 2 12 6 16" />
          <line x1="14" y1="4" x2="10" y2="20" />
        </svg>
      );
    case "Product":
      return (
        <svg {...common}>
          <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
      );
    case "Sales":
      return (
        <svg {...common}>
          <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
          <polyline points="16 7 22 7 22 13" />
        </svg>
      );
    case "Strategic":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
        </svg>
      );
    case "Operations":
      return (
        <svg {...common}>
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "Hiring":
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <line x1="19" y1="8" x2="19" y2="14" />
          <line x1="22" y1="11" x2="16" y2="11" />
        </svg>
      );
    case "Marketing":
      return (
        <svg {...common}>
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
  }
}

/** SVG color for a milestone status pip (mirrors company-level pips). */
function milestonePipColor(
  status: string,
  targetDate: string,
  asOfYmd: string,
  asOf: Date
): string {
  if (status === "Done") return "#7ba68a";
  const has = targetDate.trim().length > 0;
  if (has && targetDate < asOfYmd) return "#ef4444";
  if (has) {
    const horizon = getMilestoneDueHorizon(targetDate, asOf);
    return horizonChipFill(horizon);
  }
  return "#71717a";
}

function horizonChipFill(horizon: MilestoneDueHorizon): string {
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

/** Convert `#rrggbb` to a `"r, g, b"` triple for use inside `rgba(...)`. */
function hexToRgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "113, 113, 122";
  const n = parseInt(m[1]!, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/**
 * One project as a freely-floating bubble inside the focused goal. Visual
 * language at level 2 (icons + colour, almost no text):
 *
 * - **Project-type glyph** centered — the dominant differentiator between
 *   sibling projects on the same goal.
 * - **Outer ring** colored by workflow status (emerald moving, sage done,
 *   amber for review, rose stuck/blocked, muted grey idle).
 * - **Progress arc** wrapping the bubble — % complete at a glance.
 * - **Priority flag** at 1 o'clock with priority color.
 * - **Spotlight spark** (top-right) and **at-risk pulse** (bottom-left)
 *   reusing the existing keyframes (`atlas-spark-pulse` / `atlas-pulse-soft`).
 * - **Milestone status pips** along an inner arc at the bottom — capped at
 *   8, colored by status / due horizon; each pip shows that milestone’s
 *   health, is hoverable (name + due + status), and opens that milestone’s
 *   Slack thread popover on click.
 * - **Owner avatar** at 7 o'clock (small).
 * - **Target-date chip** below the bubble, color-shifts when overdue.
 * - **Subtle priority glow** — outer drop-shadow whose color and intensity
 *   come from the project's priority.
 */
export function AtlasProject({
  project,
  owner,
  showLabel,
  isFocused,
  isDimmed,
  scale,
  asOfYmd,
  asOf,
  onClick,
  onMilestoneStatusClick,
}: AtlasProjectProps) {
  const p = project.project;
  const priority = p.priority as Priority;
  const priorityColor = PRIORITY_COLOR[priority] ?? PRIORITY_COLOR.P2;
  const glowAlpha = PRIORITY_GLOW_ALPHA[priority] ?? 0;
  const ringColor = projectStatusStrokeColor(p.status);

  const fillOpacity = project.isStale ? 0.04 : project.isAtRisk ? 0.08 : 0.14;

  const arcLen = (p.progress / 100) * (2 * Math.PI * project.r * 0.86);

  const inv = 1 / Math.max(scale, 0.0001);
  const onScreenR = project.r * scale;

  // Type glyph fills the disc center.
  const glyphSize = project.r * 0.85;

  // Priority flag — 1 o'clock just outside disc.
  const flagAngleDeg = -55;
  const flagAngle = (flagAngleDeg * Math.PI) / 180;
  const flagX = project.cx + Math.cos(flagAngle) * project.r * 0.95;
  const flagY = project.cy + Math.sin(flagAngle) * project.r * 0.95;

  // Spotlight spark — slightly offset so it doesn't overlap the flag.
  const sparkAngleDeg = -35;
  const sparkAngle = (sparkAngleDeg * Math.PI) / 180;
  const sparkX = project.cx + Math.cos(sparkAngle) * project.r * 1.12;
  const sparkY = project.cy + Math.sin(sparkAngle) * project.r * 1.12;
  const sparkSize = Math.max(4, project.r * 0.18);

  // At-risk pulse — bottom-left.
  const overdueAngleDeg = 215;
  const overdueAngle = (overdueAngleDeg * Math.PI) / 180;
  const overdueX = project.cx + Math.cos(overdueAngle) * project.r * 1.05;
  const overdueY = project.cy + Math.sin(overdueAngle) * project.r * 1.05;
  const overdueR = Math.max(2, project.r * 0.085);

  // Milestone status pips along an inner arc near the bottom of the disc.
  const pipCap = 8;
  const pips = p.milestones.slice(0, pipCap);
  const pipR = project.r * 0.72;
  const pipDotR = Math.max(1.2, project.r * 0.055);
  const pipSpanStart = 215;
  const pipSpanEnd = 325;
  const pipSpan = pipSpanEnd - pipSpanStart;

  // Owner avatar — bottom-right inside the bubble.
  const ownerAvatarR = Math.max(6, project.r * 0.22);
  const ownerAngleDeg = 130;
  const ownerAngle = (ownerAngleDeg * Math.PI) / 180;
  const ownerX = project.cx + Math.cos(ownerAngle) * project.r * 0.6;
  const ownerY = project.cy + Math.sin(ownerAngle) * project.r * 0.6;

  // Target-date chip text + color.
  const hasDate = p.targetDate.trim().length > 0;
  const dateLabel = hasDate
    ? formatRelativeCalendarDate(p.targetDate, asOf, {
        omitFuturePreposition: true,
      })
    : "";
  const dateChipColor = (() => {
    if (!hasDate) return "#71717a";
    const horizon = getMilestoneDueHorizon(p.targetDate, asOf);
    return horizonChipFill(horizon);
  })();

  const nameLines = wrapLabel(p.name, 22, 2);

  const isClickable = !isFocused;
  const [hover, setHover] = useState(false);
  const isHovering = Boolean(hover && isClickable && !isDimmed);
  const [milestoneHover, setMilestoneHover] = useState<null | {
    milestone: Milestone;
    rect: { left: number; top: number; width: number; height: number };
  }>(null);

  // Milestone pips: hover (tooltip) + click (thread popover) only while L2
  // is interactive — not when this project is focused at L3+ or dimmed.
  const milestonePipInteractive =
    onMilestoneStatusClick != null && !isFocused && !isDimmed;

  const baseStrokeW =
    p.status === "Done" || p.status === "For Review"
      ? 2
      : project.isAtRisk
        ? 1.4
        : 1.3;
  const outerDiscStrokeW = isClickable && isHovering ? baseStrokeW + 0.3 : baseStrokeW;

  const priorityHalo =
    glowAlpha > 0
      ? `drop-shadow(0 0 ${isFocused ? 5 : 3}px rgba(${hexToRgb(priorityColor)}, ${glowAlpha}))`
      : "";
  const categoryHoverHalo =
    isHovering && !isFocused
      ? `drop-shadow(0 0 7px rgba(${hexToRgb(project.color)}, 0.28))`
      : "";
  const projectFilter = [priorityHalo, categoryHoverHalo]
    .filter((s) => s.length > 0)
    .join(" ") || undefined;

  return (
    <g
      className="atlas-fade"
      data-atlas-interactive={!isFocused ? "true" : undefined}
      style={{
        opacity: isDimmed ? 0.16 : 1,
        cursor: isClickable ? "pointer" : "default",
        filter: projectFilter,
        transition: "filter 200ms ease",
      }}
      onPointerEnter={() => {
        if (isClickable && !isDimmed) setHover(true);
      }}
      onPointerLeave={() => setHover(false)}
      onClick={(e) => {
        e.stopPropagation();
        if (isClickable) onClick();
      }}
    >
      <title>{p.name}</title>

      {/* Outer disc */}
      <circle
        cx={project.cx}
        cy={project.cy}
        r={project.r}
        fill={project.color}
        fillOpacity={fillOpacity}
        stroke={ringColor}
        strokeOpacity={project.isStale ? 0.55 : isHovering ? 0.98 : 0.92}
        strokeWidth={outerDiscStrokeW}
        strokeDasharray={project.isStale ? "3 3" : "none"}
        vectorEffect="non-scaling-stroke"
        style={{ transition: "stroke 200ms ease, stroke-width 200ms ease, stroke-opacity 200ms ease" }}
      />

      {/* Progress arc */}
      {!project.isStale && p.progress > 0 ? (
        <circle
          cx={project.cx}
          cy={project.cy}
          r={project.r * 0.86}
          fill="none"
          stroke={project.color}
          strokeWidth={1.8}
          strokeDasharray={`${arcLen} 99999`}
          transform={`rotate(-90 ${project.cx} ${project.cy})`}
          opacity={0.92}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ) : null}

      {/* Project-type glyph centered */}
      <ProjectTypeGlyph
        type={p.type}
        cx={project.cx}
        cy={project.cy - project.r * 0.06}
        size={glyphSize}
        stroke={project.isStale ? "#71717a" : "#e4e4e7"}
      />

      {/* Milestone status pips — each dot is that milestone’s status; click
          opens its thread; hover shows a quick summary. */}
      {pips.length > 0 ? (
        <g>
          {pips.map((m, i) => {
            const t = pips.length === 1 ? 0.5 : i / (pips.length - 1);
            const deg = pipSpanStart + pipSpan * t;
            const rad = (deg * Math.PI) / 180;
            const x = project.cx + Math.cos(rad) * pipR;
            const y = project.cy + Math.sin(rad) * pipR;
            const fill = milestonePipColor(
              m.status,
              m.targetDate,
              asOfYmd,
              asOf
            );
            const hot = milestoneHover?.milestone.id === m.id;
            const interactive = milestonePipInteractive;
            const hitR = Math.max(10, pipDotR * 2.4);
            return (
              <g
                key={m.id}
                data-atlas-interactive={interactive ? "true" : undefined}
                style={{ cursor: interactive ? "pointer" : "default" }}
                pointerEvents={interactive ? "auto" : "none"}
                onPointerDown={
                  interactive
                    ? (e: ReactPointerEvent<SVGGElement>) => {
                        e.stopPropagation();
                      }
                    : undefined
                }
                onPointerEnter={
                  interactive
                    ? (e: ReactPointerEvent<SVGGElement>) => {
                        const el = e.currentTarget as unknown as SVGGraphicsElement;
                        const r = el.getBoundingClientRect();
                        setMilestoneHover({
                          milestone: m,
                          rect: {
                            left: r.left,
                            top: r.top,
                            width: r.width,
                            height: r.height,
                          },
                        });
                      }
                    : undefined
                }
                onPointerLeave={
                  interactive
                    ? () => {
                        setMilestoneHover(null);
                      }
                    : undefined
                }
                onClick={
                  interactive
                    ? (e: ReactMouseEvent<SVGGElement>) => {
                        e.stopPropagation();
                        const el = e.currentTarget as unknown as SVGGraphicsElement;
                        const r = el.getBoundingClientRect();
                        onMilestoneStatusClick!(project.id, m.id, {
                          left: r.left,
                          top: r.top,
                          width: r.width,
                          height: r.height,
                        });
                      }
                    : undefined
                }
              >
                {interactive ? (
                  <title>
                    {m.name} — {m.status}
                    {m.targetDate.trim() ? ` — ${m.targetDate}` : ""} — click
                    for thread
                  </title>
                ) : null}
                {interactive ? (
                  <circle cx={x} cy={y} r={hitR} fill="transparent" />
                ) : null}
                {hot && interactive ? (
                  <circle
                    cx={x}
                    cy={y}
                    r={pipDotR + 2.2}
                    fill="none"
                    stroke="rgba(16, 185, 129, 0.65)"
                    strokeWidth={1.2}
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  />
                ) : null}
                <circle
                  cx={x}
                  cy={y}
                  r={pipDotR}
                  fill={fill}
                  fillOpacity={0.95}
                  stroke={hot && interactive ? "#a7f3d0" : "#09090b"}
                  strokeWidth={hot && interactive ? 1.35 : 1.05}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              </g>
            );
          })}
        </g>
      ) : null}

      {/* Priority flag */}
      <g
        pointerEvents="none"
        transform={`translate(${flagX} ${flagY}) scale(${inv}) translate(${-flagX} ${-flagY})`}
      >
        <SvgFlagIcon
          x={flagX - 5}
          y={flagY - 5}
          size={10}
          fill={priorityColor}
          stroke={priorityColor}
        />
      </g>

      {/* Owner avatar */}
      {owner ? (
        <AtlasAvatar
          name={owner.name}
          profilePicturePath={owner.profilePicturePath}
          cx={ownerX}
          cy={ownerY}
          r={ownerAvatarR}
          clipId={`atlas-project-owner-${project.id}`}
        />
      ) : null}

      {/* Spotlight spark */}
      {p.spotlight ? (
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
              style={{ filter: "drop-shadow(0 0 2px rgba(251, 191, 36, 0.45))" }}
            />
          </g>
        </g>
      ) : null}

      {/* At-risk pulse — visual cue only; use milestone pips for thread status. */}
      {project.isAtRisk ? (
        <g pointerEvents="none">
          <title>At risk — check red / due milestone pips along the bottom arc</title>
          <circle
            cx={overdueX}
            cy={overdueY}
            r={overdueR * 1.9}
            fill="#c06a6a"
            fillOpacity={0.18}
            className="atlas-pulse-soft"
            pointerEvents="none"
          />
          <circle
            cx={overdueX}
            cy={overdueY}
            r={overdueR}
            fill="#ef4444"
            fillOpacity={0.95}
            pointerEvents="none"
          />
        </g>
      ) : null}

      {/* Label block (level 2 only): name above + date chip below the disc. */}
      <g
        className="atlas-fade"
        style={{ opacity: showLabel ? 1 : 0, pointerEvents: "none" }}
        transform={`translate(${project.cx} ${project.cy}) scale(${inv}) translate(${-project.cx} ${-project.cy})`}
      >
        {nameLines.map((line, i) => (
          <text
            key={i}
            x={project.cx}
            y={
              project.cy -
              onScreenR -
              10 -
              (nameLines.length - 1 - i) * 13
            }
            textAnchor="middle"
            fontSize={11}
            fill={project.isStale ? "#a1a1aa" : "#f4f4f5"}
            fontWeight={500}
          >
            {line}
          </text>
        ))}

        {hasDate ? (
          <g transform={`translate(${project.cx} ${project.cy + onScreenR + 14})`}>
            {(() => {
              const fontSize = 9;
              const padX = 6;
              const padY = 3;
              const charW = fontSize * 0.62;
              const textW = dateLabel.length * charW;
              const iconW = 10;
              const iconGap = 4;
              const w = textW + padX * 2 + iconW + iconGap;
              const h = fontSize + padY * 2;
              return (
                <>
                  <rect
                    x={-w / 2}
                    y={-h / 2}
                    width={w}
                    height={h}
                    rx={h / 2}
                    fill="#09090b"
                    fillOpacity={0.85}
                    stroke={dateChipColor}
                    strokeOpacity={0.7}
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                  <g transform={`translate(${-w / 2 + padX} ${-5})`}>
                    <AtlasCalendarGlyph
                      x={0}
                      y={0}
                      size={10}
                      stroke={dateChipColor}
                    />
                  </g>
                  <text
                    x={-w / 2 + padX + iconW + iconGap}
                    y={0}
                    textAnchor="start"
                    dominantBaseline="middle"
                    fontSize={fontSize}
                    fontWeight={600}
                    letterSpacing={0.6}
                    fill={dateChipColor}
                  >
                    {dateLabel}
                  </text>
                </>
              );
            })()}
          </g>
        ) : null}
      </g>
      {milestoneHover ? (
        <AtlasMilestonePipTip
          milestone={milestoneHover.milestone}
          asOfYmd={asOfYmd}
          asOf={asOf}
          anchorRect={milestoneHover.rect}
        />
      ) : null}
    </g>
  );
}
