import { AtlasAvatar } from "./AtlasAvatar";
import type { LaidProject, Person } from "./atlas-types";

interface AtlasProjectProps {
  project: LaidProject;
  owner: Person | undefined;
  /** Show the project's label + owner + progress (only at zoom level 2). */
  showLabel: boolean;
  /** True when this project is the focused one (level 3+). */
  isFocused: boolean;
  /** True when another project in the same company is focused — renders faded. */
  isDimmed: boolean;
  onClick: () => void;
}

export function AtlasProject({
  project,
  owner,
  showLabel,
  isFocused,
  isDimmed,
  onClick,
}: AtlasProjectProps) {
  const p = project.project;
  const fillOpacity = project.isStale ? 0.04 : project.isAtRisk ? 0.08 : 0.16;
  const textOpacity = project.isStale ? 0.55 : 0.95;

  const arcLen = (p.progress / 100) * (2 * Math.PI * project.r * 0.82);

  const progressLabel =
    project.isAtRisk && !project.isStale
      ? `${p.progress}% · AT RISK`
      : project.isStale
        ? `${p.progress}% · IDLE`
        : `${p.progress}%`;

  // Strokes: at-risk gets an amber ring; stale gets dashed grey; otherwise the
  // project's grouping color.
  const strokeColor = project.isAtRisk
    ? "#c06a6a"
    : project.isStale
      ? "#71717a"
      : project.color;
  const strokeDash = project.isStale ? "3 3" : "none";
  const strokeOpacity = project.isStale ? 0.6 : 1;

  return (
    <g
      className="atlas-fade"
      style={{
        opacity: isDimmed ? 0.12 : 1,
        cursor: isFocused ? "default" : "pointer",
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (!isFocused) onClick();
      }}
    >
      <circle
        cx={project.cx}
        cy={project.cy}
        r={project.r}
        fill={project.color}
        fillOpacity={fillOpacity}
        stroke={strokeColor}
        strokeOpacity={strokeOpacity}
        strokeWidth={p.status === "Done" || p.status === "For Review" ? 2 : 1.3}
        strokeDasharray={strokeDash}
        vectorEffect="non-scaling-stroke"
      />
      {/* Progress arc */}
      {!project.isStale && p.progress > 0 ? (
        <circle
          cx={project.cx}
          cy={project.cy}
          r={project.r * 0.82}
          fill="none"
          stroke={project.color}
          strokeWidth={1.8}
          strokeDasharray={`${arcLen} 99999`}
          transform={`rotate(-90 ${project.cx} ${project.cy})`}
          opacity={0.9}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}

      <g
        className="atlas-fade"
        style={{ opacity: showLabel ? textOpacity : 0, pointerEvents: "none" }}
      >
        <text
          x={project.cx}
          y={project.cy - project.r * 0.08}
          textAnchor="middle"
          fontSize={project.r * 0.26}
          fill="#f4f4f5"
          fontWeight={500}
        >
          {p.name}
        </text>
        {owner ? (
          <AtlasAvatar
            name={owner.name}
            profilePicturePath={owner.profilePicturePath}
            cx={project.cx - project.r * 0.22}
            cy={project.cy + project.r * 0.3}
            r={project.r * 0.14}
            clipId={`atlas-avatar-project-${project.id}`}
          />
        ) : null}
        <text
          x={project.cx + project.r * 0.02}
          y={project.cy + project.r * 0.36}
          textAnchor="start"
          fontSize={project.r * 0.14}
          fill="#a1a1aa"
          letterSpacing={0.8}
        >
          {progressLabel}
        </text>
      </g>
    </g>
  );
}
