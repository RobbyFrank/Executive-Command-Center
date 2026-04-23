import type { LaidCompany } from "./atlas-types";

interface AtlasCompanyProps {
  company: LaidCompany;
  /** True when this company is the current focus target (renders brighter). */
  isFocused: boolean;
  /** True when another company is focused — renders faded. */
  isDimmed: boolean;
  /** True at overview level (shows name + stats inside the circle). */
  showLabel: boolean;
  onClick: () => void;
}

/** Company outer circle + overview label. Clickable when it has projects. */
export function AtlasCompany({
  company,
  isFocused,
  isDimmed,
  showLabel,
  onClick,
}: AtlasCompanyProps) {
  const clickable = company.projectCount > 0;
  const stuckTotal = company.atRiskCount + company.stuckCount;
  const labelFontSize = Math.max(16, company.r * 0.22);
  const statFontSize = Math.max(9, company.r * 0.08);

  return (
    <g
      className="atlas-fade"
      style={{ opacity: isDimmed ? 0.08 : 1, cursor: clickable && !isFocused ? "pointer" : "default" }}
      onClick={(e) => {
        e.stopPropagation();
        if (clickable && !isFocused) onClick();
      }}
    >
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

      <g
        className="atlas-fade"
        style={{ opacity: showLabel ? 1 : 0, pointerEvents: "none" }}
      >
        <text
          x={company.cx}
          y={company.cy - 4}
          textAnchor="middle"
          fontSize={labelFontSize}
          fill="#e4e4e7"
          fontStyle="italic"
          fontWeight={500}
        >
          {company.name}
        </text>
        {company.projectCount > 0 ? (
          <text
            x={company.cx}
            y={company.cy + labelFontSize * 0.9}
            textAnchor="middle"
            fontSize={statFontSize}
            letterSpacing={1.2}
            fill={stuckTotal > 0 ? "#fca5a5" : "#71717a"}
          >
            {company.projectCount} PROJECT
            {company.projectCount === 1 ? "" : "S"}
            {stuckTotal > 0
              ? ` · ${stuckTotal} AT RISK`
              : ""}
          </text>
        ) : (
          <text
            x={company.cx}
            y={company.cy + labelFontSize * 0.9}
            textAnchor="middle"
            fontSize={statFontSize}
            letterSpacing={1.2}
            fill="#52525b"
          >
            QUIET
          </text>
        )}
      </g>
    </g>
  );
}
