import type { ProjectStatus, ProjectWithMilestones } from "@/lib/types/tracker";
import type { LaidCompany } from "./atlas-types";

interface AtlasCompanyProps {
  company: LaidCompany;
  /** True when this company is the current focus target (renders brighter). */
  isFocused: boolean;
  /** True when another company is focused — renders faded. */
  isDimmed: boolean;
  /** True at overview level (shows logo + stats inside the circle). */
  showLabel: boolean;
  /**
   * Current camera scale. Text labels (fallback name + stats line) are
   * wrapped in counter-scaled groups so they stay at a fixed on-screen size
   * regardless of zoom depth. The logo image lives in the camera-scaled
   * coordinate space and grows/shrinks with the circle it sits inside —
   * which is the desired behaviour.
   */
  scale: number;
  onClick: () => void;
}

/** YYYY-MM-DD comparison for "is overdue" — done as plain string compare. */
function todayYmd(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Color for one project status pip. */
const STATUS_PIP_COLOR: Record<ProjectStatus, string> = {
  Done: "#7ba68a",
  "In Progress": "#10b981",
  "For Review": "#d4a857",
  Stuck: "#c06a6a",
  Blocked: "#c06a6a",
  Idea: "#71717a",
  Pending: "#52525b",
};

/**
 * Map an activity score (0–100) to a momentum band: color (used by gauge +
 * count number), and a soft glow color (used by hover drop-shadow on the
 * outer stroke).
 */
function momentumBand(activity: number): {
  color: string;
  glow: string;
  countColor: string;
} {
  if (activity >= 55) {
    return {
      color: "#10b981",
      glow: "rgba(16, 185, 129, 0.35)",
      countColor: "#a7f3d0",
    };
  }
  if (activity >= 30) {
    return {
      color: "#d4a857",
      glow: "rgba(212, 168, 87, 0.32)",
      countColor: "#fde68a",
    };
  }
  if (activity >= 1) {
    return {
      color: "#c06a6a",
      glow: "rgba(192, 106, 106, 0.30)",
      countColor: "#fca5a5",
    };
  }
  return { color: "#3f3f46", glow: "rgba(0,0,0,0)", countColor: "#a1a1aa" };
}

/** Build an SVG path arc between two angles (degrees, SVG y-down) on a circle. */
function arcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number
): string {
  const start = (startDeg * Math.PI) / 180;
  const end = (endDeg * Math.PI) / 180;
  const sx = cx + Math.cos(start) * r;
  const sy = cy + Math.sin(start) * r;
  const ex = cx + Math.cos(end) * r;
  const ey = cy + Math.sin(end) * r;
  const sweep = endDeg > startDeg ? 1 : 0;
  const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  return `M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} ${sweep} ${ex} ${ey}`;
}

/**
 * Company outer circle + logo + compact icon/colour signals.
 *
 * Visual language at the overview (icons + colour, never new text):
 * - Centered **logo** (or italic name fallback) identifies the company.
 * - Tiny **project count** number whose colour reflects the momentum band.
 * - Bottom **momentum gauge** — coloured arc whose length tracks the
 *   company's activity score and whose colour reflects the band
 *   (emerald → amber → rose). A faint full-track arc behind it gives the
 *   gauge a fixed silhouette regardless of momentum.
 * - Top **at-risk arc** — red arc proportional to the share of at-risk
 *   projects. Lives on the opposite half from the momentum gauge.
 * - **Status pips** — tiny coloured dots (one per project, capped at 12)
 *   along an inner arc, each coloured by project status.
 * - **Spotlight spark** — small star at ~1 o'clock when any goal/project
 *   on the company is in the spotlight.
 * - **Overdue pulse** — soft red dot at ~7 o'clock when any milestone is
 *   past its target date and still open.
 *
 * All extra chrome is hidden once the user drills in (`isFocused === true`),
 * so the inner scene reads cleanly.
 */
export function AtlasCompany({
  company,
  isFocused,
  isDimmed,
  showLabel,
  scale,
  onClick,
}: AtlasCompanyProps) {
  const clickable = company.projectCount > 0;
  const stuckTotal = company.atRiskCount + company.stuckCount;
  const hasProjects = company.projectCount > 0;
  const hasRisk = stuckTotal > 0 && hasProjects;

  const logoPath = company.company.logoPath?.trim() ?? "";
  const hasLogo = logoPath.length > 0;

  // Derived signals — flatten projects/goals/milestones once.
  const projects: ProjectWithMilestones[] = [];
  for (const goal of company.company.goals) {
    for (const project of goal.projects) projects.push(project);
  }
  const hasSpotlight =
    company.company.goals.some((g) => g.spotlight) ||
    projects.some((p) => p.spotlight);
  const today = todayYmd();
  const hasOverdue = projects.some((p) =>
    p.milestones.some(
      (m) => m.status !== "Done" && m.targetDate && m.targetDate < today
    )
  );

  const band = momentumBand(company.activity);

  // Logo fills ~55% of the circle's radius (in viewBox units — grows with
  // the circle, unlike the count number which is counter-scaled). Nudged
  // slightly upward to leave room for the count below it.
  const logoR = company.r * 0.55;
  const logoCy = company.cy - company.r * 0.08;

  // Counter-scaled text group uses on-screen viewBox units for offsets and
  // font sizes. 1 SVG unit inside the wrapper == 1 on-screen pixel.
  const inv = 1 / Math.max(scale, 0.0001);
  const countFontSize = 11;
  const nameFontSize = Math.min(22, Math.max(13, company.r * 0.14));
  const clipId = `atlas-company-logo-${company.id}`;
  const fillGradientId = `atlas-company-fill-${company.id}`;

  // At-risk arc on the outer stroke. Centered at 12 o'clock, spans an angle
  // proportional to `stuckTotal / projectCount` (capped so a 100% at-risk
  // company still leaves a small gap at the bottom for visual clarity).
  const riskArcR = company.r;
  const riskCircumference = 2 * Math.PI * riskArcR;
  const riskFraction = hasRisk
    ? Math.min(0.92, stuckTotal / Math.max(1, company.projectCount))
    : 0;
  const riskArcLen = riskCircumference * riskFraction;
  // SVG circle starts drawing at 3 o'clock. Rotate so the arc is symmetric
  // around 12 o'clock: start at `-90° - half the sweep`, measured in
  // degrees.
  const riskArcRotationDeg = -90 - (riskFraction * 360) / 2;

  // Bottom momentum gauge (mirrors the at-risk arc on the opposite half).
  // Track always renders at low opacity; bar reveals momentum/100.
  const gaugeR = company.r * 0.94;
  const gaugeStartDeg = 200; // ≈ 8 o'clock
  const gaugeEndDeg = 340; // ≈ 4 o'clock
  const gaugeSpan = gaugeEndDeg - gaugeStartDeg;
  const momentumFrac = Math.max(0, Math.min(1, company.activity / 100));
  const gaugeBarEndDeg = gaugeStartDeg + gaugeSpan * momentumFrac;
  const gaugeTrackPath = arcPath(
    company.cx,
    company.cy,
    gaugeR,
    gaugeStartDeg,
    gaugeEndDeg
  );
  const gaugeBarPath =
    momentumFrac > 0
      ? arcPath(
          company.cx,
          company.cy,
          gaugeR,
          gaugeStartDeg,
          gaugeBarEndDeg
        )
      : null;

  // Status pips along an inner arc just above the gauge.
  const pipR = company.r * 0.78;
  const pipDotR = Math.max(1.4, company.r * 0.022);
  const pipCap = 12;
  const pipProjects = projects.slice(0, pipCap);
  const pipSpanStart = 215;
  const pipSpanEnd = 325;
  const pipSpan = pipSpanEnd - pipSpanStart;
  // Spread pips evenly. With a single pip, pin to the bottom (270°).
  const pipPositions = pipProjects.map((project, i) => {
    const t =
      pipProjects.length === 1 ? 0.5 : i / (pipProjects.length - 1);
    const deg = pipSpanStart + pipSpan * t;
    const rad = (deg * Math.PI) / 180;
    return {
      project,
      x: company.cx + Math.cos(rad) * pipR,
      y: company.cy + Math.sin(rad) * pipR,
    };
  });

  // Spotlight spark (top-right) and overdue dot (bottom-left).
  const sparkAngleDeg = -55; // ≈ 1–2 o'clock
  const sparkAngle = (sparkAngleDeg * Math.PI) / 180;
  const sparkX = company.cx + Math.cos(sparkAngle) * company.r * 0.92;
  const sparkY = company.cy + Math.sin(sparkAngle) * company.r * 0.92;
  const sparkSize = Math.max(5, company.r * 0.08);

  const overdueAngleDeg = 215; // ≈ 7–8 o'clock
  const overdueAngle = (overdueAngleDeg * Math.PI) / 180;
  const overdueX = company.cx + Math.cos(overdueAngle) * company.r * 0.95;
  const overdueY = company.cy + Math.sin(overdueAngle) * company.r * 0.95;
  const overdueR = Math.max(2, company.r * 0.035);

  const showOverviewChrome = showLabel && !isFocused;

  const isClickable = clickable && !isFocused;
  return (
    <g
      className="atlas-fade"
      // Mark as interactive only when this bubble is actually clickable.
      // The canvas-level pointer handler uses this attribute to decide
      // whether to start a pan (background) or defer to the bubble's own
      // click handler.
      data-atlas-interactive={isClickable ? "true" : undefined}
      style={{
        opacity: isDimmed ? 0.08 : 1,
        cursor: isClickable ? "pointer" : "default",
        filter: isFocused
          ? `drop-shadow(0 0 18px ${band.glow})`
          : hasProjects
            ? `drop-shadow(0 0 6px ${band.glow})`
            : undefined,
        transition: "filter 600ms ease",
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (isClickable) onClick();
      }}
    >
      <title>
        {company.name}
        {hasProjects
          ? ` — ${company.projectCount} project${company.projectCount === 1 ? "" : "s"}${
              hasRisk ? `, ${stuckTotal} at risk` : ""
            }`
          : ""}
      </title>

      <defs>
        {/* Soft inner-glass gradient for the bubble fill — slightly lighter
            top-left, darker bottom-right edge. Gives a premium glassy feel
            without an SVG filter. */}
        <radialGradient
          id={fillGradientId}
          cx="35%"
          cy="30%"
          r="80%"
          fx="35%"
          fy="30%"
        >
          <stop offset="0%" stopColor="#27272a" stopOpacity={isFocused ? 0.35 : 0.7} />
          <stop offset="65%" stopColor="#18181b" stopOpacity={isFocused ? 0.25 : 0.6} />
          <stop offset="100%" stopColor="#09090b" stopOpacity={isFocused ? 0.15 : 0.55} />
        </radialGradient>
      </defs>

      <circle
        cx={company.cx}
        cy={company.cy}
        r={company.r}
        fill={`url(#${fillGradientId})`}
        stroke="#3f3f46"
        strokeOpacity={isFocused ? 0.45 : 0.7}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />

      {/* Bottom momentum gauge — track + bar. Hidden once focused. */}
      {showOverviewChrome && hasProjects ? (
        <g pointerEvents="none">
          <path
            d={gaugeTrackPath}
            fill="none"
            stroke="#27272a"
            strokeOpacity={0.85}
            strokeWidth={2}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {gaugeBarPath ? (
            <path
              d={gaugeBarPath}
              fill="none"
              stroke={band.color}
              strokeOpacity={0.95}
              strokeWidth={2.5}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </g>
      ) : null}

      {/* At-risk arc — overview marker only. Hidden once the user drills
          into the company since individual at-risk projects carry their own
          coloured strokes inside, making this outer arc redundant. */}
      {hasRisk && showOverviewChrome ? (
        <circle
          cx={company.cx}
          cy={company.cy}
          r={riskArcR}
          fill="none"
          stroke="#ef4444"
          strokeOpacity={0.9}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={`${riskArcLen} ${riskCircumference}`}
          transform={`rotate(${riskArcRotationDeg} ${company.cx} ${company.cy})`}
          vectorEffect="non-scaling-stroke"
        >
          <title>
            {stuckTotal} of {company.projectCount} project
            {company.projectCount === 1 ? "" : "s"} at risk
          </title>
        </circle>
      ) : null}

      {/* Status pips — one per project (capped), arc'd inside the bubble. */}
      {showOverviewChrome && pipProjects.length > 0 ? (
        <g pointerEvents="none">
          {pipPositions.map(({ project, x, y }) => (
            <circle
              key={project.id}
              cx={x}
              cy={y}
              r={pipDotR}
              fill={STATUS_PIP_COLOR[project.status] ?? "#71717a"}
              fillOpacity={0.95}
            />
          ))}
        </g>
      ) : null}

      {/* Spotlight spark — small 8-point star, tinted amber, gently pulses.
          Outer <g> handles positioning + size (SVG attribute transform);
          inner <g> handles the CSS keyframe pulse so the two transforms
          compose without one stomping the other. */}
      {showOverviewChrome && hasSpotlight ? (
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

      {/* Overdue pulse — soft rose dot at lower-left when something is past due. */}
      {showOverviewChrome && hasOverdue ? (
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

      {/* Logo (or fallback name) — only visible at overview level. */}
      <g
        className="atlas-fade"
        style={{ opacity: showLabel ? 1 : 0, pointerEvents: "none" }}
      >
        {hasLogo ? (
          <>
            <defs>
              <clipPath id={clipId}>
                <circle cx={company.cx} cy={logoCy} r={logoR} />
              </clipPath>
            </defs>
            <image
              href={logoPath}
              x={company.cx - logoR}
              y={logoCy - logoR}
              width={logoR * 2}
              height={logoR * 2}
              clipPath={`url(#${clipId})`}
              preserveAspectRatio="xMidYMid slice"
            />
          </>
        ) : (
          <g
            transform={`translate(${company.cx} ${logoCy}) scale(${inv}) translate(${-company.cx} ${-logoCy})`}
          >
            <text
              x={company.cx}
              y={logoCy + nameFontSize * 0.35}
              textAnchor="middle"
              fontSize={nameFontSize}
              fill="#e4e4e7"
              fontStyle="italic"
              fontWeight={500}
            >
              {company.name}
            </text>
          </g>
        )}
      </g>

      {/* Tiny project-count number — shown only when the company has
          projects. Silent companies intentionally render no caption. Color
          is driven by the momentum band so a quick glance reads "healthy"
          (mint), "watch" (amber), or "trouble" (rose). */}
      {hasProjects ? (
        <g
          className="atlas-fade"
          style={{ opacity: showLabel ? 1 : 0, pointerEvents: "none" }}
          transform={`translate(${company.cx} ${company.cy}) scale(${inv}) translate(${-company.cx} ${-company.cy})`}
        >
          <text
            x={company.cx}
            y={company.cy + company.r * 0.62}
            textAnchor="middle"
            fontSize={countFontSize}
            fontWeight={600}
            fill={hasRisk ? "#fca5a5" : band.countColor}
            letterSpacing={0.4}
            className="tabular-nums"
          >
            {company.projectCount}
          </text>
        </g>
      ) : null}
    </g>
  );
}
