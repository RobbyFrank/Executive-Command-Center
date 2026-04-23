import { AtlasAvatar } from "./AtlasAvatar";
import type { LaidProject, Person } from "./atlas-types";

interface AtlasProjectProps {
  project: LaidProject;
  owner: Person | undefined;
  /**
   * Show the full text label (name + avatar + progress meta) below the
   * project circle. Used at level 2 (focused group), where there are few
   * enough projects that labels won't collide.
   */
  showLabel: boolean;
  /**
   * Compact mode used at level 1 (whole company). Just renders the owner
   * avatar inside the project circle — no text — so ringed projects don't
   * pile labels on top of each other. The avatar scales with the circle
   * size in the outer camera's coordinate space.
   */
  showAvatarOnly: boolean;
  /** True when this project is the focused one (level 3+). */
  isFocused: boolean;
  /** True when another project in the same company is focused — renders faded. */
  isDimmed: boolean;
  /**
   * Current camera scale. Text labels are rendered inside a counter-scaled
   * <g> so they stay at a readable on-screen size regardless of zoom depth.
   * Inside that wrapper, offsets from (cx, cy) are in on-screen viewBox
   * units (the outer camera scale and the inverse scale cancel out).
   */
  scale: number;
  onClick: () => void;
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
  // Ellipsise if any words remain unaccommodated.
  const used = lines.join(" ");
  if (used.length < label.length && lines.length > 0) {
    const last = lines[lines.length - 1]!;
    lines[lines.length - 1] = truncate(last, maxChars);
  }
  return lines;
}

export function AtlasProject({
  project,
  owner,
  showLabel,
  showAvatarOnly,
  isFocused,
  isDimmed,
  scale,
  onClick,
}: AtlasProjectProps) {
  const p = project.project;
  const fillOpacity = project.isStale ? 0.04 : project.isAtRisk ? 0.08 : 0.16;
  const textOpacity = project.isStale ? 0.6 : 0.95;

  const arcLen = (p.progress / 100) * (2 * Math.PI * project.r * 0.82);

  const progressLabel =
    project.isAtRisk && !project.isStale
      ? `${p.progress}% · AT RISK`
      : project.isStale
        ? `${p.progress}% · IDLE`
        : `${p.progress}%`;

  // Strokes: at-risk gets an amber ring; stale gets dashed grey; otherwise
  // the project's grouping color.
  const strokeColor = project.isAtRisk
    ? "#c06a6a"
    : project.isStale
      ? "#71717a"
      : project.color;
  const strokeDash = project.isStale ? "3 3" : "none";
  const strokeOpacity = project.isStale ? 0.6 : 1;

  // Counter-scale wrapper for the "big" text label block (level 2).
  const inv = 1 / Math.max(scale, 0.0001);
  const onScreenR = project.r * scale;
  const nameFont = 12;
  const metaFont = 9;
  const lineGap = 2;
  // Tight wrapping so ringed projects' labels don't collide horizontally.
  // Labels sit BELOW the circle, stacked downward.
  const nameLines = wrapLabel(p.name, 22, 2);

  return (
    <g
      className="atlas-fade"
      // Interactive only when not already focused (clicking the focused
      // project is a no-op; panning should still work over its area).
      data-atlas-interactive={isFocused ? undefined : "true"}
      style={{
        opacity: isDimmed ? 0.12 : 1,
        cursor: isFocused ? "default" : "pointer",
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (!isFocused) onClick();
      }}
    >
      <title>{p.name}</title>

      <circle
        cx={project.cx}
        cy={project.cy}
        r={project.r}
        fill={project.color}
        fillOpacity={fillOpacity}
        stroke={strokeColor}
        strokeOpacity={strokeOpacity}
        // Thinner at-risk stroke (1.1px) so it doesn't compete with the
        // company-level red arc at overview transitions. "Done" and
        // "For Review" projects get a slightly heavier ring to signal
        // completed/completing work.
        strokeWidth={
          p.status === "Done" || p.status === "For Review"
            ? 2
            : project.isAtRisk
              ? 1.1
              : 1.3
        }
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

      {/* Compact level-1 view: just the owner avatar centered in the circle.
          No text — labels would collide on the tight project ring. */}
      {showAvatarOnly && owner ? (
        <AtlasAvatar
          name={owner.name}
          profilePicturePath={owner.profilePicturePath}
          cx={project.cx}
          cy={project.cy}
          r={project.r * 0.48}
          clipId={`atlas-project-avatar-compact-${project.id}`}
        />
      ) : null}

      {/* Full label block (level 2 only): name, owner row + progress, sitting
          below the circle in counter-scaled on-screen units. */}
      <g
        className="atlas-fade"
        style={{ opacity: showLabel ? textOpacity : 0, pointerEvents: "none" }}
        transform={`translate(${project.cx} ${project.cy}) scale(${inv}) translate(${-project.cx} ${-project.cy})`}
      >
        {nameLines.map((line, i) => (
          <text
            key={i}
            x={project.cx}
            y={project.cy - onScreenR - 10 - (nameLines.length - 1 - i) * (nameFont + lineGap)}
            textAnchor="middle"
            fontSize={nameFont}
            fill="#f4f4f5"
            fontWeight={500}
          >
            {line}
          </text>
        ))}
        <g transform={`translate(0 ${onScreenR + metaFont + 6})`}>
          {owner ? (
            <AtlasAvatar
              name={owner.name}
              profilePicturePath={owner.profilePicturePath}
              cx={project.cx - 14}
              cy={project.cy}
              r={7}
              clipId={`atlas-project-avatar-label-${project.id}`}
            />
          ) : null}
          <text
            x={project.cx + (owner ? -2 : 0)}
            y={project.cy + 3}
            textAnchor="start"
            fontSize={metaFont}
            fill="#a1a1aa"
            letterSpacing={0.8}
          >
            {progressLabel}
          </text>
        </g>
      </g>
    </g>
  );
}
