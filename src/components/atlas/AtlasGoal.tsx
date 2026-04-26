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
import type { GoalWithProjects, Person, Priority } from "@/lib/types/tracker";
import {
  goalStatusColor,
  PRIORITY_COLOR,
  PRIORITY_GLOW_ALPHA,
} from "./atlas-activity";
import { AtlasAvatar } from "./AtlasAvatar";
import { AtlasCalendarGlyph } from "./AtlasCalendarGlyph";
import type { GroupingKey, LaidGoal } from "./atlas-types";

interface AtlasGoalProps {
  goal: LaidGoal;
  /**
   * People assigned to this goal’s projects (from `Project.assigneeIds`,
   * resolved against the roster). Shown in the goal bubble; preferred over
   * the goal owner for execution context.
   */
  projectAssignees: Person[];
  /** Optional owner of the goal (fallback avatar in-bubble if no assignees). */
  owner: Person | undefined;
  /**
   * Active atlas grouping. When `"owner"`, a prominent owner avatar is drawn
   * to the **left** of the bubble; the in-bubble owner avatar is omitted
   * to avoid duplicate cues.
   */
  grouping: GroupingKey;
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
  /** Server-provided "now" for relative due strings — keeps SSR in sync. */
  asOf: Date;
  onClick: () => void;
  /**
   * Click on the goal's status pip — opens the same delivery popover the
   * Roadmap goal row uses. Receives the pip's screen rect so the parent can
   * anchor a fixed-position popover. Omit when the parent doesn't render one.
   */
  onStatusClick?: (
    goalBucketKey: string,
    rect: { left: number; top: number; width: number; height: number }
  ) => void;
}

/** Lucide-style `Layers` glyph — same path used elsewhere in the atlas. */
function SvgLayersIcon({
  x,
  y,
  size,
  stroke = "#a1a1aa",
  strokeWidth = 2,
}: {
  x: number;
  y: number;
  size: number;
  stroke?: string;
  /** Default 2; use slightly higher on hover for a “pressed / active” read. */
  strokeWidth?: number;
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
      strokeWidth={strokeWidth}
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

const GOAL_LABEL_MAX_CHARS = 22;
const GOAL_LABEL_MAX_LINES = 4;

const ASSIGNEE_PILE_MAX_FACES = 4;

/**
 * Slightly overlapped avatars for project assignees (lower-half of goal
 * bubble). If more than `ASSIGNEE_PILE_MAX_FACES` people, the last slot is
 * a “+N” chip. The pile is centered horizontally and sized so it stays
 * inside the disc — at the same vertical band as the original single-owner
 * 5-o'clock anchor.
 */
function GoalAssigneePile({
  people,
  goalCx,
  goalCy,
  goalR,
  anchorR,
  safeId,
}: {
  people: Person[];
  goalCx: number;
  goalCy: number;
  goalR: number;
  /** Reference radius for a single avatar (matches the goal-owner spot). */
  anchorR: number;
  safeId: string;
}) {
  if (people.length === 0) return null;

  const n = people.length;
  const hasOverflow = n > ASSIGNEE_PILE_MAX_FACES;
  const showFaces = hasOverflow
    ? people.slice(0, ASSIGNEE_PILE_MAX_FACES - 1)
    : people.slice(0, ASSIGNEE_PILE_MAX_FACES);
  const overflowN = hasOverflow ? n - (ASSIGNEE_PILE_MAX_FACES - 1) : 0;
  const slotCount = hasOverflow
    ? ASSIGNEE_PILE_MAX_FACES
    : showFaces.length;

  // Vertical band: same height as the single-owner anchor (≈ 5 o'clock,
  // sin(130°)·0.7 ≈ 0.54 R below goal center).
  const cyOffset = goalR * 0.54;
  const pileCy = goalCy + cyOffset;
  // Horizontal inscribed half-width at this y, less a small margin.
  const halfWidthAtY =
    Math.sqrt(Math.max(1, goalR * goalR - cyOffset * cyOffset)) - goalR * 0.04;

  // Start from the natural avatar size (matches single-owner spot when n=1)
  // and shrink to fit if multiple avatars would otherwise spill outside the
  // disc. `slotCount + 0.6` is the pile-width-in-r-units assuming `step =
  // 1.45 r` (i.e., width = (slotCount-1)·1.45 r + 2 r).
  const pileWidthFactor = 1.45 * (slotCount - 1) + 2;
  const naturalR = Math.max(5.5, anchorR * (n === 1 ? 1 : 0.92));
  const fitR = (halfWidthAtY * 2) / pileWidthFactor;
  const r = Math.max(4, Math.min(naturalR, fitR));
  const step = r * 1.45;

  // For one avatar, keep the original 5-o'clock x so existing single-owner
  // goals look unchanged. For 2+ avatars, center the pile horizontally so
  // there is room on both sides.
  const ownerAvatarAngle = (130 * Math.PI) / 180;
  const baseCx =
    n === 1 ? goalCx + Math.cos(ownerAvatarAngle) * goalR * 0.7 : goalCx;

  const slots: ({ kind: "person"; person: Person } | { kind: "more"; n: number })[] =
    hasOverflow
      ? [
          ...showFaces.map((person) => ({ kind: "person" as const, person })),
          { kind: "more" as const, n: overflowN },
        ]
      : showFaces.map((person) => ({ kind: "person" as const, person }));

  return (
    <g pointerEvents="none">
      {slots.map((slot, i) => {
        const cx = baseCx + (i - (slotCount - 1) / 2) * step;
        const baseCy = pileCy;
        if (slot.kind === "more") {
          return (
            <g key="more">
              <title>
                {slot.n} more assignee{slot.n === 1 ? "" : "s"}
              </title>
              <circle
                cx={cx}
                cy={baseCy}
                r={r}
                fill="#18181b"
                stroke="#3f3f46"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={cx}
                y={baseCy + r * 0.32}
                textAnchor="middle"
                fontSize={r * 0.9}
                fill="#a1a1aa"
                fontWeight={600}
                style={{ pointerEvents: "none" }}
              >
                +{slot.n}
              </text>
            </g>
          );
        }
        return (
          <g key={slot.person.id}>
            <title>{slot.person.name}</title>
            <AtlasAvatar
              name={slot.person.name}
              profilePicturePath={slot.person.profilePicturePath}
              cx={cx}
              cy={baseCy}
              r={r}
              clipId={`atlas-goal-asg-${safeId}-${i}-${slot.person.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`}
            />
          </g>
        );
      })}
    </g>
  );
}

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
 * Goals have no `targetDate` in the data model. Roll up a single calendar
 * anchor for the bubble: latest project `targetDate`, else earliest open
 * milestone date.
 */
function goalDisplayDueYmd(g: GoalWithProjects): string {
  const projects = g.projects.filter((p) => !p.isMirror);
  const pDates = projects
    .map((p) => p.targetDate.trim())
    .filter((d) => d.length > 0);
  if (pDates.length > 0) {
    return pDates.reduce((a, b) => (a > b ? a : b));
  }
  const mDates: string[] = [];
  for (const p of projects) {
    for (const m of p.milestones) {
      if (m.status !== "Done" && m.targetDate.trim()) {
        mDates.push(m.targetDate.trim());
      }
    }
  }
  if (mDates.length > 0) {
    return mDates.reduce((a, b) => (a < b ? a : b));
  }
  return "";
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
  projectAssignees,
  owner,
  grouping,
  isFocused,
  isDimmed,
  showLabel,
  scale,
  asOf,
  onClick,
  onStatusClick,
}: AtlasGoalProps) {
  const g = goal.goal;
  const priority = g.priority as Priority;
  const priorityColor = PRIORITY_COLOR[priority] ?? PRIORITY_COLOR.P2;
  const glowAlpha = PRIORITY_GLOW_ALPHA[priority] ?? 0;
  const statusColor = goalStatusColor(g.status);

  const inv = 1 / Math.max(scale, 0.0001);
  const projectCount = goal.projectCount;

  const isClickable = !isFocused;
  const [hover, setHover] = useState(false);
  const [summaryHot, setSummaryHot] = useState(false);
  const isHovering = Boolean(hover && isClickable && !isDimmed);

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

  const groupByOwner = grouping === "owner";
  // Left of the disc (~9 o'clock) — only when sectioning by owner.
  const sideOwnerAngleDeg = 180;
  const sideOwnerAngle = (sideOwnerAngleDeg * Math.PI) / 180;
  const sideOwnerR = Math.max(9, goal.r * 0.22);
  const sideOwnerX =
    goal.cx + Math.cos(sideOwnerAngle) * goal.r * 1.22;
  const sideOwnerY = goal.cy + Math.sin(sideOwnerAngle) * goal.r * 0.04;

  // Adapt description font + char/line caps to the bubble's on-screen
  // size so text never overflows the disc. The goal layout sits at canvas
  // scale (≈ viewBox-pixel sized), so the radius drives sensible font
  // sizes directly.
  const onScreenR = goal.r * scale;
  const baseFont = Math.max(10, Math.min(15, goal.r * 0.13));
  const charW = baseFont * 0.55;
  const innerWidthPx = onScreenR * 1.55; // sides of disc taper — narrower than diameter
  const fitChars = Math.max(10, Math.floor(innerWidthPx / charW));
  const adaptiveMaxChars = Math.min(GOAL_LABEL_MAX_CHARS, fitChars);
  const lineH = baseFont * 1.2;
  const innerHeightPx = onScreenR * 1.45;
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

  const dueYmd = goalDisplayDueYmd(g);
  const hasDueYmd = dueYmd.trim().length > 0;
  const dueLabel = hasDueYmd
    ? formatRelativeCalendarDate(dueYmd, asOf, {
        omitFuturePreposition: true,
      })
    : "No date";
  const dueSegmentColor = hasDueYmd
    ? horizonChipFill(getMilestoneDueHorizon(dueYmd, asOf))
    : "#71717a";
  const metaPillY = onScreenR + 12;

  // Sanitize composite id (`${companyId}:${goalId}`) for use in SVG id
  // attributes — colons are valid SVG markup but break CSS selectors and
  // cause occasional cross-browser quirks inside `url(#…)`.
  const safeId = goal.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const fillGradientId = `atlas-goal-fill-${safeId}`;
  const sideOwnerClipId = `atlas-goal-owner-side-${safeId}`;
  const showInteractive = !isFocused;

  const priorityHalo =
    glowAlpha > 0
      ? `drop-shadow(0 0 ${isFocused ? 6 : 4}px rgba(${hexToRgb(priorityColor)}, ${glowAlpha}))`
      : "";
  const categoryHoverHalo =
    isHovering && !isFocused
      ? `drop-shadow(0 0 8px rgba(${hexToRgb(goal.color)}, 0.3))`
      : "";
  const goalFilter = [priorityHalo, categoryHoverHalo]
    .filter((s) => s.length > 0)
    .join(" ") || undefined;

  return (
    <g
      className="atlas-fade"
      data-atlas-interactive={showInteractive ? "true" : undefined}
      style={{
        opacity: isDimmed ? 0.12 : 1,
        cursor: isClickable ? "pointer" : "default",
        filter: goalFilter,
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
      <title>
        {g.description} — due {dueLabel} — {projectCount} project
        {projectCount === 1 ? "" : "s"}
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

      {/* Status pip — small dot at 11 o'clock. Click opens the same
          delivery popover used on the Roadmap goal row. */}
      {showLabel ? (
        <g
          data-atlas-interactive={onStatusClick ? "true" : undefined}
          style={{ cursor: onStatusClick ? "pointer" : "default" }}
          onPointerDown={
            onStatusClick
              ? (e: ReactPointerEvent<SVGGElement>) => e.stopPropagation()
              : undefined
          }
          onClick={
            onStatusClick
              ? (e: ReactMouseEvent<SVGGElement>) => {
                  e.stopPropagation();
                  const el = e.currentTarget as unknown as SVGGraphicsElement;
                  const rect = el.getBoundingClientRect();
                  onStatusClick(goal.bucketKey, {
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                  });
                }
              : undefined
          }
          transform={`translate(${statusX} ${statusY}) scale(${inv}) translate(${-statusX} ${-statusY})`}
        >
          <title>
            {g.status}
            {onStatusClick ? " · click for goal delivery details" : ""}
          </title>
          {/* Transparent hit area — small pip is hard to click on dense goals. */}
          <circle
            cx={statusX}
            cy={statusY}
            r={10}
            fill="transparent"
          />
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
              style={{ filter: "drop-shadow(0 0 2px rgba(251, 191, 36, 0.45))" }}
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

      {showLabel && groupByOwner ? (
        <g
          pointerEvents="none"
          transform={`translate(${sideOwnerX} ${sideOwnerY}) scale(${inv}) translate(${-sideOwnerX} ${-sideOwnerY})`}
        >
          <circle
            cx={sideOwnerX}
            cy={sideOwnerY}
            r={sideOwnerR + 1.2}
            fill="none"
            stroke={goal.color}
            strokeOpacity={0.55}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          <AtlasAvatar
            name={owner?.name?.trim() ? owner.name : "Unassigned"}
            profilePicturePath={owner?.profilePicturePath}
            cx={sideOwnerX}
            cy={sideOwnerY}
            r={sideOwnerR}
            clipId={sideOwnerClipId}
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

      {/* One metadata pill: due + project count (right segment shows hover to signal “open goal”). */}
      {showLabel ? (
        <g
          transform={`translate(${goal.cx} ${goal.cy}) scale(${inv}) translate(${-goal.cx} ${-goal.cy})`}
        >
          <g
            transform={`translate(${goal.cx} ${goal.cy + metaPillY})`}
            style={{ pointerEvents: "all" }}
            onPointerDown={(e: ReactPointerEvent<SVGGElement>) => {
              e.stopPropagation();
            }}
            onClick={(e: ReactMouseEvent<SVGGElement>) => {
              e.stopPropagation();
              if (isClickable) onClick();
            }}
          >
            {(() => {
              const fontSize = 9.5;
              const padX = 8;
              const padY = 4;
              const iconS = 10;
              const afterIcon = 4;
              const sectionGap = 10;
              const charDue = fontSize * 0.6;
              const charProj = fontSize * 0.58;
              const countStr = String(projectCount);
              const dueW = dueLabel.length * charDue;
              const countW = countStr.length * charProj;
              const leftCluster = iconS + afterIcon + dueW;
              const rightCluster = iconS + afterIcon + countW;
              const w = 2 * padX + leftCluster + sectionGap + rightCluster;
              const h = fontSize + padY * 2;
              const projStroke = summaryHot
                ? "#6ee7b7"
                : projectCount === 0
                  ? "#52525b"
                  : "#a1a1aa";
              const projFill = projectCount === 0 ? "#a1a1aa" : "#f4f4f5";
              const x0 = -w / 2;
              const yMid = 0;
              const calX = x0 + padX;
              const dueTextX = calX + iconS + afterIcon;
              const dueEndX = dueTextX + dueW;
              const layersX = calX + leftCluster + sectionGap;
              const dotX = dueEndX + sectionGap / 2;
              const countCenterX = layersX + iconS + afterIcon + countW / 2;
              const summarySegLeft = dotX - 2;
              const summarySegW = Math.max(10, x0 + w - summarySegLeft - 6);
              const iconCenterX = layersX + iconS / 2;
              return (
                <>
                  <title>
                    {g.description} — {dueLabel} — {countStr} project
                    {projectCount === 1 ? "" : "s"}. Click to open this goal.
                  </title>
                  <rect
                    x={x0}
                    y={-h / 2}
                    width={w}
                    height={h}
                    rx={h / 2}
                    fill="#09090b"
                    fillOpacity={0.88}
                    stroke="#3f3f46"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    style={{ cursor: isClickable ? "pointer" : "default" }}
                  />
                  <rect
                    x={summarySegLeft}
                    y={-h / 2}
                    width={summarySegW}
                    height={h}
                    rx={h / 2}
                    fill={
                      summaryHot
                        ? "rgba(16, 185, 129, 0.2)"
                        : "transparent"
                    }
                    stroke={
                      summaryHot
                        ? "rgba(52, 211, 153, 0.65)"
                        : "transparent"
                    }
                    strokeWidth={summaryHot ? 1.35 : 1}
                    vectorEffect="non-scaling-stroke"
                    style={{
                      pointerEvents: "all",
                      cursor: isClickable ? "pointer" : "default",
                      // Smooth pill highlight; SVG attributes still snap — ok for a soft cue.
                      transition:
                        "fill 0.2s ease, stroke 0.2s ease, stroke-width 0.2s ease",
                    }}
                    onPointerEnter={() => {
                      if (isClickable && !isDimmed) setSummaryHot(true);
                    }}
                    onPointerLeave={() => setSummaryHot(false)}
                  />
                  <g transform={`translate(${calX} ${-5})`} pointerEvents="none">
                    <AtlasCalendarGlyph
                      x={0}
                      y={0}
                      size={10}
                      stroke={dueSegmentColor}
                    />
                  </g>
                  <text
                    x={dueTextX}
                    y={yMid}
                    textAnchor="start"
                    dominantBaseline="middle"
                    fontSize={fontSize}
                    fontWeight={600}
                    letterSpacing={0.2}
                    fill={dueSegmentColor}
                    pointerEvents="none"
                  >
                    {dueLabel}
                  </text>
                  <text
                    x={dotX}
                    y={yMid}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={fontSize + 1}
                    fill={summaryHot ? "rgba(52, 211, 153, 0.4)" : "#52525b"}
                    aria-hidden
                    pointerEvents="none"
                  >
                    ·
                  </text>
                  <g
                    style={{
                      filter: summaryHot
                        ? "drop-shadow(0 0 5px rgba(52, 211, 153, 0.7)) drop-shadow(0 0 12px rgba(16, 185, 129, 0.4))"
                        : "none",
                      transition: "filter 0.22s ease",
                    }}
                    pointerEvents="none"
                  >
                    <g
                      transform={
                        summaryHot
                          ? `translate(${iconCenterX} 0) scale(1.1) translate(${-iconCenterX} 0)`
                          : "translate(0 0)"
                      }
                    >
                      {summaryHot ? (
                        <circle
                          cx={iconCenterX}
                          cy={0}
                          r={12}
                          fill="none"
                          stroke="rgba(52, 211, 153, 0.4)"
                          strokeWidth={1.2}
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : null}
                      <SvgLayersIcon
                        x={layersX}
                        y={-5}
                        size={10}
                        stroke={projStroke}
                        strokeWidth={summaryHot ? 2.45 : 2}
                      />
                    </g>
                  </g>
                  <text
                    x={countCenterX}
                    y={yMid}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={summaryHot ? fontSize + 0.6 : fontSize}
                    fontWeight={summaryHot ? 700 : 600}
                    fill={summaryHot ? "#ffffff" : projFill}
                    className="tabular-nums"
                    letterSpacing={0.02}
                    pointerEvents="none"
                    style={{
                      transition: "fill 0.2s ease, font-size 0.2s ease, font-weight 0.2s ease",
                    }}
                  >
                    {countStr}
                  </text>
                </>
              );
            })()}
          </g>
        </g>
      ) : null}

      {/* Project assignees (preferred) or goal owner in-bubble. */}
      {showLabel && (projectAssignees.length > 0 || (owner && !groupByOwner)) ? (
        projectAssignees.length > 0 ? (
          <GoalAssigneePile
            people={projectAssignees}
            goalCx={goal.cx}
            goalCy={goal.cy}
            goalR={goal.r}
            anchorR={ownerAvatarR}
            safeId={safeId}
          />
        ) : (
          <g pointerEvents="none">
            <AtlasAvatar
              name={owner!.name}
              profilePicturePath={owner!.profilePicturePath}
              cx={ownerAvatarX}
              cy={ownerAvatarY}
              r={ownerAvatarR}
              clipId={`atlas-goal-owner-${safeId}`}
            />
          </g>
        )
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
