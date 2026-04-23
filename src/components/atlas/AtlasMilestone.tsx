import type { LaidMilestone } from "./atlas-types";

interface AtlasMilestoneProps {
  milestone: LaidMilestone;
  /** Show the milestone's name + status (at level 2 or when focused at level 3). */
  showLabel: boolean;
  /** True when this milestone is the current focus target. */
  isFocused: boolean;
  /** True when another milestone is focused — renders faded. */
  isDimmed: boolean;
  onClick: () => void;
}

export function AtlasMilestone({
  milestone,
  showLabel,
  isFocused,
  isDimmed,
  onClick,
}: AtlasMilestoneProps) {
  const m = milestone.milestone;
  const isDone = m.status === "Done";
  const arcLen = (isDone ? 1 : 0) * (2 * Math.PI * milestone.r * 0.78);
  const statusLabel = isDone ? "DONE" : m.targetDate ? "NOT DONE" : "PLANNED";

  return (
    <g
      className="atlas-fade"
      style={{
        opacity: isDimmed ? 0.2 : 1,
        cursor: isFocused ? "default" : "pointer",
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (!isFocused) onClick();
      }}
    >
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
      >
        <text
          x={milestone.cx}
          y={milestone.cy - milestone.r - milestone.r * 0.5}
          textAnchor="middle"
          fontSize={milestone.r * 0.5}
          fill="#f4f4f5"
          fontWeight={500}
        >
          {m.name}
        </text>
        <text
          x={milestone.cx}
          y={milestone.cy + milestone.r + milestone.r * 0.8}
          textAnchor="middle"
          fontSize={milestone.r * 0.32}
          fill={milestone.color}
          letterSpacing={1}
        >
          {statusLabel}
        </text>
      </g>
    </g>
  );
}
