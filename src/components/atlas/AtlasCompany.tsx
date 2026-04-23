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

/**
 * Company outer circle + logo + compact activity markers.
 *
 * Visual language (intentionally low-text):
 * - Centered **logo** (or italic name fallback) identifies the company.
 * - Tiny **project count** number under the logo — only rendered when the
 *   company has ≥1 project. Silent companies read as "quiet" purely from
 *   the bare circle; the word "QUIET" is avoided.
 * - Thin **red arc** along the top of the circle (12 o'clock, symmetric)
 *   whose sweep is proportional to the fraction of at-risk projects. An
 *   at-a-glance risk gauge that never adds chrome unless there's risk.
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

      <circle
        cx={company.cx}
        cy={company.cy}
        r={company.r}
        fill="#18181b"
        fillOpacity={isFocused ? 0.2 : 0.55}
        stroke="#52525b"
        strokeWidth={1.2}
        vectorEffect="non-scaling-stroke"
      />
      {/* Activity shimmer — brighter ring when the company is busy */}
      <circle
        cx={company.cx}
        cy={company.cy}
        r={company.r * 0.985}
        fill="none"
        stroke="#10b981"
        strokeOpacity={Math.min(0.45, company.activity / 220)}
        strokeWidth={1.2}
        vectorEffect="non-scaling-stroke"
      />
      {/* At-risk arc — overview marker only. Hidden once the user drills
          into the company since individual at-risk projects carry their own
          coloured strokes inside, making this outer arc redundant. */}
      {hasRisk && !isFocused ? (
        <circle
          cx={company.cx}
          cy={company.cy}
          r={riskArcR}
          fill="none"
          stroke="#ef4444"
          strokeOpacity={0.85}
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
          projects. Silent companies intentionally render no caption. */}
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
            fontWeight={500}
            fill={hasRisk ? "#fca5a5" : "#a1a1aa"}
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
