"use client";

import { useCallback, useMemo, useState } from "react";
import type { CompanyWithGoals, Person } from "@/lib/types/tracker";
import { AtlasBreadcrumbs, type AtlasCrumb } from "./AtlasBreadcrumbs";
import { AtlasCompany } from "./AtlasCompany";
import { AtlasGroupingToggle } from "./AtlasGroupingToggle";
import { AtlasMilestone } from "./AtlasMilestone";
import { AtlasMilestonePanel } from "./AtlasMilestonePanel";
import { AtlasProject } from "./AtlasProject";
import {
  CANVAS_H,
  CANVAS_W,
  layoutCompanies,
  layoutCompanyInner,
  positionMilestones,
} from "./atlas-layout";
import type {
  CameraTarget,
  GroupingKey,
  LaidCompany,
  LaidGroup,
  LaidMilestone,
  LaidProject,
} from "./atlas-types";

interface PortfolioAtlasProps {
  hierarchy: CompanyWithGoals[];
  people: Person[];
}

/**
 * Focus path: [companyId, groupKey, projectId, milestoneId]. Length = current
 * zoom level (0 = overview, 4 = milestone panel open).
 */
type FocusPath = string[];

const HINTS = [
  "Click a company to zoom in",
  "Click a group to see its projects",
  "Click a project to reveal milestones",
  "Click a milestone to open its Slack thread",
];

export function PortfolioAtlas({ hierarchy, people }: PortfolioAtlasProps) {
  const [focusPath, setFocusPath] = useState<FocusPath>([]);
  const [grouping, setGroupingState] = useState<GroupingKey>("goal");

  /**
   * Switching grouping invalidates the bucket key in `focusPath[1]` (and
   * therefore anything deeper). Drop back to the company level so the user
   * can pick a new group in the new grouping's set.
   */
  const setGrouping = useCallback((next: GroupingKey) => {
    setGroupingState(next);
    setFocusPath((prev) => (prev.length > 1 ? prev.slice(0, 1) : prev));
  }, []);

  const peopleById = useMemo(() => {
    const map = new Map<string, Person>();
    for (const p of people) map.set(p.id, p);
    return map;
  }, [people]);

  const companies = useMemo<LaidCompany[]>(
    () => layoutCompanies(hierarchy),
    [hierarchy]
  );

  const focusedCompany = useMemo(
    () => (focusPath[0] ? companies.find((c) => c.id === focusPath[0]) : undefined),
    [focusPath, companies]
  );

  const inner = useMemo(() => {
    if (!focusedCompany) return null;
    return layoutCompanyInner(focusedCompany, grouping, peopleById);
  }, [focusedCompany, grouping, peopleById]);

  const focusedGroup = useMemo<LaidGroup | undefined>(() => {
    if (!inner || !focusPath[1]) return undefined;
    return inner.groups.find((g) => g.bucketKey === focusPath[1]);
  }, [inner, focusPath]);

  const focusedProject = useMemo<LaidProject | undefined>(() => {
    if (!inner || !focusPath[2]) return undefined;
    return inner.projects.find((p) => p.id === focusPath[2]);
  }, [inner, focusPath]);

  const focusedMilestones = useMemo(() => {
    if (!focusedProject) return [];
    return positionMilestones(focusedProject);
  }, [focusedProject]);

  const focusedMilestoneLaid = useMemo(() => {
    if (!focusPath[3]) return undefined;
    return focusedMilestones.find((m) => m.id === focusPath[3]);
  }, [focusPath, focusedMilestones]);

  const level = focusPath.length;

  // Camera target per level.
  const cameraTarget = useMemo<CameraTarget | null>(() => {
    if (focusedProject) return focusedProject;
    if (focusedGroup) return focusedGroup;
    if (focusedCompany) return focusedCompany;
    return null;
  }, [focusedCompany, focusedGroup, focusedProject]);

  const { scale, tx, ty } = useMemo(() => {
    if (!cameraTarget) return { scale: 1, tx: 0, ty: 0 };
    const s = Math.min(CANVAS_W, CANVAS_H) / (cameraTarget.r * 2.9);
    return {
      scale: s,
      tx: CANVAS_W / 2 - cameraTarget.cx * s,
      ty: CANVAS_H / 2 - cameraTarget.cy * s,
    };
  }, [cameraTarget]);

  const popLevel = useCallback(() => {
    setFocusPath((prev) => (prev.length === 0 ? prev : prev.slice(0, -1)));
  }, []);

  const crumbs: AtlasCrumb[] = [
    {
      label: "Portfolio",
      onClick: () => setFocusPath([]),
      active: focusPath.length === 0,
    },
  ];
  if (focusedCompany) {
    crumbs.push({
      label: focusedCompany.name,
      onClick: () => setFocusPath([focusedCompany.id]),
      active: focusPath.length === 1,
    });
  }
  if (focusedGroup && focusedCompany) {
    crumbs.push({
      label: focusedGroup.label,
      onClick: () =>
        setFocusPath([focusedCompany.id, focusedGroup.bucketKey]),
      active: focusPath.length === 2,
    });
  }
  if (focusedProject && focusedCompany && focusedGroup) {
    crumbs.push({
      label: focusedProject.project.name,
      onClick: () =>
        setFocusPath([
          focusedCompany.id,
          focusedGroup.bucketKey,
          focusedProject.id,
        ]),
      active: focusPath.length === 3,
    });
  }
  if (focusedMilestoneLaid) {
    crumbs.push({
      label: focusedMilestoneLaid.milestone.name,
      onClick: () => {},
      active: true,
    });
  }

  // Milestone panel context
  const milestonePanelProps = useMemo(() => {
    if (!focusedMilestoneLaid || !focusedProject || !focusedCompany) return null;
    const goal = focusedCompany.company.goals.find(
      (g) => g.id === focusedProject.project.goalId
    );
    const owner = peopleById.get(focusedProject.project.ownerId);
    return {
      milestone: focusedMilestoneLaid.milestone,
      project: focusedProject.project,
      owner,
      goalDescription: goal?.description ?? "",
      companyName: focusedCompany.name,
    };
  }, [
    focusedMilestoneLaid,
    focusedProject,
    focusedCompany,
    peopleById,
  ]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-zinc-950">
      <style>{`
        .atlas-fade { transition: opacity 600ms ease; }
        .atlas-camera { transition: transform 900ms cubic-bezier(0.7, 0, 0.2, 1); transform-origin: 0 0; }
        .atlas-surface {
          background:
            radial-gradient(circle at 20% 20%, rgba(16, 185, 129, 0.06), transparent 60%),
            radial-gradient(circle at 80% 70%, rgba(139, 92, 246, 0.05), transparent 55%),
            #09090b;
        }
      `}</style>

      <div className="atlas-surface pointer-events-none absolute inset-0" />

      {/* Header (top-left) */}
      <div className="pointer-events-none absolute left-6 top-6 z-10 select-none">
        <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-zinc-500">
          Portfolio atlas
        </p>
        <h1 className="mt-0.5 text-lg italic text-zinc-100">Momentum map</h1>
      </div>

      {/* Grouping toggle (top, centered) */}
      <div className="pointer-events-auto absolute left-1/2 top-6 z-10 -translate-x-1/2">
        <AtlasGroupingToggle
          value={grouping}
          onChange={setGrouping}
          disabled={!focusedCompany}
        />
      </div>

      {/* Breadcrumbs (top-right) */}
      <div className="pointer-events-auto absolute right-6 top-6 z-10">
        <AtlasBreadcrumbs crumbs={crumbs} />
      </div>

      {/* Hint (bottom center) */}
      <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 font-mono text-[9px] uppercase tracking-[0.3em] text-zinc-500">
        {HINTS[Math.min(level, HINTS.length - 1)]}
      </div>

      <svg
        viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
        className="relative z-0 h-full w-full"
        onClick={popLevel}
        role="img"
        aria-label="Portfolio atlas canvas"
      >
        <g
          className="atlas-camera"
          style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}
        >
          {companies.map((company) => {
            const isFocused = focusedCompany?.id === company.id;
            const isDimmed = Boolean(focusedCompany) && !isFocused;

            return (
              <g key={company.id}>
                <AtlasCompany
                  company={company}
                  isFocused={isFocused}
                  isDimmed={isDimmed}
                  showLabel={level === 0}
                  onClick={() => setFocusPath([company.id])}
                />

                {isFocused && inner
                  ? renderCompanyInner({
                      company,
                      inner,
                      peopleById,
                      focusedGroup,
                      focusedProject,
                      focusedMilestoneLaid,
                      level,
                      focusPath,
                      setFocusPath,
                    })
                  : null}
              </g>
            );
          })}
        </g>
      </svg>

      {milestonePanelProps ? (
        <AtlasMilestonePanel
          {...milestonePanelProps}
          onClose={popLevel}
        />
      ) : null}
    </div>
  );
}

/**
 * Render one focused company's inner scene (groups + projects + milestones).
 * Factored out to keep the main component readable.
 */
function renderCompanyInner(args: {
  company: LaidCompany;
  inner: { groups: LaidGroup[]; projects: LaidProject[] };
  peopleById: Map<string, Person>;
  focusedGroup: LaidGroup | undefined;
  focusedProject: LaidProject | undefined;
  focusedMilestoneLaid: LaidMilestone | undefined;
  level: number;
  focusPath: FocusPath;
  setFocusPath: (next: FocusPath) => void;
}) {
  const {
    company,
    inner,
    peopleById,
    focusedGroup,
    focusedProject,
    focusedMilestoneLaid,
    level,
    focusPath,
    setFocusPath,
  } = args;

  const showGroupLabels = level === 1;

  return (
    <g>
      {inner.groups.map((group) => {
        const isGroupFocused = focusedGroup?.bucketKey === group.bucketKey;
        const isGroupDimmed = Boolean(focusedGroup) && !isGroupFocused;
        const clickable = level === 1 && !isGroupFocused;

        return (
          <g
            key={group.id}
            className="atlas-fade"
            style={{
              opacity: isGroupDimmed ? 0.1 : 1,
              cursor: clickable ? "pointer" : "default",
            }}
            onClick={(e) => {
              if (!clickable) return;
              e.stopPropagation();
              setFocusPath([company.id, group.bucketKey]);
            }}
          >
            <circle
              cx={group.cx}
              cy={group.cy}
              r={group.r}
              fill={group.color}
              fillOpacity={0.04}
              stroke={group.color}
              strokeOpacity={0.35}
              strokeWidth={1.2}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
            <g
              style={{ pointerEvents: "none", opacity: showGroupLabels ? 1 : 0 }}
              className="atlas-fade"
            >
              <text
                x={group.cx}
                y={group.cy - group.r - group.r * 0.14}
                textAnchor="middle"
                fontSize={Math.max(9, group.r * 0.14)}
                fill={group.color}
                letterSpacing={1}
              >
                {group.label.toUpperCase()}
              </text>
              <text
                x={group.cx}
                y={group.cy - group.r + group.r * 0.1}
                textAnchor="middle"
                fontSize={Math.max(8, group.r * 0.1)}
                fill="#71717a"
              >
                {group.projectCount} PROJECT
                {group.projectCount === 1 ? "" : "S"}
              </text>
            </g>
          </g>
        );
      })}

      {inner.projects.map((project) => {
        const owner = peopleById.get(project.project.ownerId);
        const inFocusedGroup =
          focusedGroup?.projects.some((p) => p.id === project.id) ?? false;
        const visible = level >= 2 ? inFocusedGroup : true;
        const isProjectFocused = focusedProject?.id === project.id;
        const isProjectDimmed =
          (level >= 2 && !inFocusedGroup) ||
          (level >= 3 && !isProjectFocused);

        if (!visible && level >= 2) {
          // Projects in other groups fade out once a group is focused
          return (
            <g
              key={project.id}
              className="atlas-fade"
              style={{ opacity: 0, pointerEvents: "none" }}
            />
          );
        }

        return (
          <g key={project.id}>
            <AtlasProject
              project={project}
              owner={owner}
              showLabel={level === 1}
              isFocused={isProjectFocused}
              isDimmed={isProjectDimmed}
              onClick={() => {
                // Auto-descend through the group when clicking a project at level 1,
                // otherwise keep the current group focus.
                const groupKey = level < 2 ? project.bucketKey : focusPath[1]!;
                setFocusPath([company.id, groupKey, project.id]);
              }}
            />

            {isProjectFocused && level >= 3
              ? positionMilestones(project).map((m) => {
                  const isMFocused = focusedMilestoneLaid?.id === m.id;
                  const isMDimmed = level === 4 && !isMFocused;
                  return (
                    <AtlasMilestone
                      key={m.id}
                      milestone={m}
                      showLabel={level === 3 || (level === 4 && isMFocused)}
                      isFocused={isMFocused}
                      isDimmed={isMDimmed}
                      onClick={() =>
                        setFocusPath([
                          company.id,
                          focusPath[1]!,
                          project.id,
                          m.id,
                        ])
                      }
                    />
                  );
                })
              : null}
          </g>
        );
      })}
    </g>
  );
}
