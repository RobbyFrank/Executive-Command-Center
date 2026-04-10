"use client";

import Link from "next/link";
import { useMemo } from "react";
import type {
  CompanyDirectoryStats,
  CompanyWithGoals,
  Person,
  PersonWorkload,
} from "@/lib/types/tracker";
import { isReviewStale } from "@/lib/reviewStaleness";
import { projectMatchesCloseWatch } from "@/lib/closeWatch";
import { isProjectZombie } from "@/lib/zombie";
import { MomentumBar } from "./MomentumBar";
import { WorkloadBar } from "./WorkloadBar";
import { cn } from "@/lib/utils";
import { buildRoadmapHref } from "@/lib/roadmap-query";
import {
  formatRelativeCalendarDate,
  parseCalendarDateString,
} from "@/lib/relativeCalendarDate";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarClock,
  ChevronRight,
  Clock,
  Eye,
  Flame,
  Ghost,
  Rocket,
  ShieldAlert,
  Target,
  Timer,
  UserX,
  Zap,
  type LucideIcon,
} from "lucide-react";

interface SummaryDashboardProps {
  hierarchy: CompanyWithGoals[];
  people: Person[];
  workloads: PersonWorkload[];
  companyStatsByCompanyId: Record<string, CompanyDirectoryStats>;
}

/* ---------- Shared avatar / logo helpers ---------- */

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0][0];
    const b = parts[1][0];
    if (a && b) return (a + b).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

function PersonAvatar({
  person,
  size = "md",
}: {
  person: Person;
  size?: "sm" | "md" | "lg";
}) {
  const path = person.profilePicturePath?.trim();
  const box =
    size === "sm"
      ? "h-6 w-6"
      : size === "lg"
        ? "h-10 w-10"
        : "h-8 w-8";
  const textSize =
    size === "sm" ? "text-[10px]" : size === "lg" ? "text-sm" : "text-xs";

  if (path) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={path}
        alt=""
        className={cn(
          "shrink-0 rounded-full object-cover ring-1 ring-zinc-700",
          box
        )}
      />
    );
  }
  return (
    <span
      className={cn(
        "shrink-0 rounded-full flex items-center justify-center font-medium bg-zinc-800 ring-1 ring-zinc-700 text-zinc-300",
        box,
        textSize
      )}
      aria-hidden
    >
      {initialsFromName(person.name)}
    </span>
  );
}

function CompanyLogo({
  company,
  size = "md",
}: {
  company: CompanyWithGoals;
  size?: "sm" | "md" | "lg";
}) {
  const path = company.logoPath?.trim();
  const box =
    size === "sm"
      ? "h-6 w-6"
      : size === "lg"
        ? "h-10 w-10"
        : "h-8 w-8";
  const iconSize =
    size === "sm"
      ? "h-3 w-3"
      : size === "lg"
        ? "h-5 w-5"
        : "h-4 w-4";

  if (path) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={path}
        alt=""
        title={company.name}
        className={cn(
          "shrink-0 rounded-lg object-cover ring-1 ring-zinc-700",
          box
        )}
      />
    );
  }
  return (
    <span
      className={cn(
        "shrink-0 rounded-lg flex items-center justify-center bg-zinc-800 ring-1 ring-zinc-700 text-zinc-400",
        box
      )}
      aria-hidden
      title={company.name}
    >
      <Building2 className={iconSize} />
    </span>
  );
}

/* ---------- StatCard ---------- */

function StatCard({
  label,
  value,
  hint,
  href,
  icon: Icon,
  accentClass,
}: {
  label: string;
  value: number;
  hint?: string;
  href?: string;
  icon: LucideIcon;
  accentClass: string;
}) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 pr-6">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">
            {label}
          </p>
          <p className="text-2xl font-bold tabular-nums text-zinc-100 mt-1.5">
            {value}
          </p>
          {hint ? (
            <p className="text-[11px] text-zinc-600 mt-1 leading-tight">
              {hint}
            </p>
          ) : null}
        </div>
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            accentClass
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
      {href ? (
        <ChevronRight
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          aria-hidden
        />
      ) : null}
    </>
  );

  const shellClass =
    "group relative rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-4 transition-colors";

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          shellClass,
          "block hover:border-zinc-600 hover:bg-zinc-900/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
        )}
        aria-label={`Open Roadmap: ${label}`}
      >
        {inner}
      </Link>
    );
  }

  return <div className={cn(shellClass, "hover:border-zinc-700")}>{inner}</div>;
}

function dayDiffFromToday(target: Date, today: Date): number {
  const t = Date.UTC(
    target.getFullYear(),
    target.getMonth(),
    target.getDate()
  );
  const r = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  return Math.round((t - r) / 86400000);
}

function DueChip({ diffDays }: { diffDays: number }) {
  if (diffDays < 0) {
    return (
      <span className="shrink-0 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium tabular-nums text-red-400">
        {diffDays === -1 ? "Yesterday" : `${Math.abs(diffDays)}d overdue`}
      </span>
    );
  }
  if (diffDays === 0) {
    return (
      <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-400">
        Today
      </span>
    );
  }
  if (diffDays === 1) {
    return (
      <span className="shrink-0 rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-400">
        Tomorrow
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-zinc-700/80 px-2 py-0.5 text-[11px] font-medium tabular-nums text-zinc-300">
      In {diffDays}d
    </span>
  );
}

/* ---------- Attention badge ---------- */

function AttentionBadge({ kind }: { kind: string }) {
  const config: Record<string, { bg: string; text: string }> = {
    "P0 blocked": { bg: "bg-red-500/15", text: "text-red-400" },
    Zombie: { bg: "bg-amber-500/15", text: "text-amber-400" },
    "At risk": { bg: "bg-orange-500/15", text: "text-orange-400" },
  };
  const c = config[kind] ?? { bg: "bg-zinc-800", text: "text-zinc-400" };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        c.bg,
        c.text
      )}
    >
      {kind}
    </span>
  );
}

/* ---------- Main ---------- */

export function SummaryDashboard({
  hierarchy,
  people,
  workloads,
  companyStatsByCompanyId,
}: SummaryDashboardProps) {
  const peopleById = useMemo(
    () => new Map(people.map((p) => [p.id, p])),
    [people]
  );

  const companyById = useMemo(
    () => new Map(hierarchy.map((c) => [c.id, c])),
    [hierarchy]
  );

  const maxLoad = useMemo(
    () => Math.max(1, ...workloads.map((w) => w.totalProjects)),
    [workloads]
  );

  const stats = useMemo(() => {
    let p0Goals = 0;
    let p0Projects = 0;
    let blocked = 0;
    let zombies = 0;
    let needReviewGoals = 0;
    let needReviewProjects = 0;
    let closeWatch = 0;
    let atRisk = 0;
    let unassignedGoals = 0;
    let unassignedProjects = 0;
    let highLeverage = 0;
    let timeSensitive = 0;

    for (const c of hierarchy) {
      for (const g of c.goals) {
        if (g.priority === "P0") p0Goals++;
        if (!g.ownerId) unassignedGoals++;
        if (g.atRisk) atRisk++;
        if (
          isReviewStale(
            g.lastReviewed,
            "goal",
            peopleById.get(g.ownerId)?.autonomyScore
          )
        )
          needReviewGoals++;
        if (g.costOfDelay >= 4 && g.status !== "In Progress") timeSensitive++;

        for (const p of g.projects) {
          if (p.priority === "P0") p0Projects++;
          if (p.status === "Blocked") blocked++;
          if (isProjectZombie(p)) zombies++;
          if (!p.ownerId) unassignedProjects++;
          if (p.atRisk) atRisk++;
          if (
            isReviewStale(
              p.lastReviewed,
              "project",
              peopleById.get(p.ownerId)?.autonomyScore
            )
          )
            needReviewProjects++;
          if (projectMatchesCloseWatch(p, people)) closeWatch++;
          if (g.impactScore >= 4 && p.complexityScore <= 2) highLeverage++;
        }
      }
    }

    return {
      p0Total: p0Goals + p0Projects,
      blocked,
      zombies,
      needReview: needReviewGoals + needReviewProjects,
      closeWatch,
      atRisk,
      unassigned: unassignedGoals + unassignedProjects,
      highLeverage,
      timeSensitive,
    };
  }, [hierarchy, people, peopleById]);

  const attentionSamples = useMemo(() => {
    const seen = new Set<string>();
    const items: {
      label: string;
      sub: string;
      kind: string;
      key: string;
      companyId: string;
      goalId: string;
      projectId: string;
    }[] = [];
    for (const c of hierarchy) {
      for (const g of c.goals) {
        for (const p of g.projects) {
          if (seen.has(p.id)) continue;
          let kind: string | null = null;
          if (p.priority === "P0" && p.status === "Blocked") kind = "P0 blocked";
          else if (isProjectZombie(p)) kind = "Zombie";
          else if (p.atRisk || g.atRisk) kind = "At risk";
          if (!kind) continue;
          seen.add(p.id);
          items.push({
            key: p.id,
            label: p.name,
            sub: `${c.name} · ${g.description}`,
            kind,
            companyId: c.id,
            goalId: g.id,
            projectId: p.id,
          });
          if (items.length >= 12) return items;
        }
      }
    }
    return items;
  }, [hierarchy]);

  const upcomingDeadlines = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const rows: {
      id: string;
      diffDays: number;
      dateYmd: string;
      title: string;
      sub: string;
      goalId: string;
      projectId: string;
      companyId: string;
    }[] = [];

    for (const c of hierarchy) {
      for (const g of c.goals) {
        for (const p of g.projects) {
          const raw = p.targetDate?.trim();
          if (raw) {
            const d = parseCalendarDateString(raw);
            if (d) {
              const diffDays = dayDiffFromToday(d, today);
              rows.push({
                id: `project-${p.id}`,
                diffDays,
                dateYmd: raw,
                title: p.name,
                sub: `${c.name} · Project target`,
                goalId: g.id,
                projectId: p.id,
                companyId: c.id,
              });
            }
          }
          for (const m of p.milestones) {
            if (m.status === "Done") continue;
            const mraw = m.targetDate?.trim();
            if (!mraw) continue;
            const md = parseCalendarDateString(mraw);
            if (!md) continue;
            rows.push({
              id: `milestone-${m.id}`,
              diffDays: dayDiffFromToday(md, today),
              dateYmd: mraw,
              title: m.name,
              sub: `${c.name} · ${p.name}`,
              goalId: g.id,
              projectId: p.id,
              companyId: c.id,
            });
          }
        }
      }
    }

    rows.sort((a, b) => a.diffDays - b.diffDays);
    return rows.slice(0, 14);
  }, [hierarchy]);

  const topLoaded = useMemo(() => {
    return [...workloads]
      .filter((w) => w.totalProjects > 0)
      .sort((a, b) => b.totalProjects - a.totalProjects)
      .slice(0, 5);
  }, [workloads]);

  if (hierarchy.length === 0) {
    return (
      <div className="px-6 pb-10">
        <header className="pt-1 mb-10">
          <h1 className="text-2xl font-bold text-zinc-100 tracking-tight">
            Summary
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Portfolio health at a glance.
          </p>
        </header>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700/80 bg-zinc-900/30 px-6 py-20">
          <div className="flex items-center justify-center h-14 w-14 rounded-full bg-zinc-800/80 ring-1 ring-zinc-700 mb-5">
            <BarChart3 className="h-7 w-7 text-zinc-500" />
          </div>
          <h2 className="text-base font-semibold text-zinc-200 mb-1.5">Nothing to summarize yet</h2>
          <p className="text-sm text-zinc-500 text-center max-w-md">
            Metrics, attention items, and deadlines will appear here once you have companies with goals and projects. Start by adding companies on the{" "}
            <Link href="/companies" className="text-zinc-400 underline underline-offset-2 hover:text-zinc-200 transition-colors">
              Companies
            </Link>{" "}
            page, then create goals and projects on the{" "}
            <Link href="/" className="text-zinc-400 underline underline-offset-2 hover:text-zinc-200 transition-colors">
              Roadmap
            </Link>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 pb-10 space-y-10">
      {/* Header */}
      <header className="pt-1">
        <h1 className="text-2xl font-bold text-zinc-100 tracking-tight">
          Summary
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          Portfolio health at a glance. Click a metric or row to open the
          Roadmap with matching filters.
        </p>
      </header>

      {/* Key Metrics */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-4">
          Key metrics
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
          <StatCard
            label="P0 (goals + projects)"
            value={stats.p0Total}
            href={buildRoadmapHref({ priorityFilterIds: ["P0"] })}
            icon={Flame}
            accentClass="bg-red-500/15 text-red-400"
          />
          <StatCard
            label="Blocked"
            value={stats.blocked}
            href={buildRoadmapHref({ statusEnumFilterIds: ["Blocked"] })}
            icon={ShieldAlert}
            accentClass="bg-orange-500/15 text-orange-400"
          />
          <StatCard
            label="Zombies"
            value={stats.zombies}
            href={buildRoadmapHref({ statusTagFilterIds: ["zombie"] })}
            icon={Ghost}
            accentClass="bg-amber-500/15 text-amber-400"
          />
          <StatCard
            label="Need review"
            value={stats.needReview}
            href={buildRoadmapHref({ statusTagFilterIds: ["need_review"] })}
            icon={Eye}
            accentClass="bg-blue-500/15 text-blue-400"
          />
          <StatCard
            label="Close watch"
            value={stats.closeWatch}
            href={buildRoadmapHref({ statusTagFilterIds: ["close_watch"] })}
            icon={Target}
            accentClass="bg-purple-500/15 text-purple-400"
          />
          <StatCard
            label="At risk (flagged)"
            value={stats.atRisk}
            href={buildRoadmapHref({ statusTagFilterIds: ["at_risk"] })}
            icon={AlertTriangle}
            accentClass="bg-rose-500/15 text-rose-400"
          />
          <StatCard
            label="Unassigned rows"
            value={stats.unassigned}
            href={buildRoadmapHref({ statusTagFilterIds: ["unassigned"] })}
            icon={UserX}
            accentClass="bg-zinc-500/15 text-zinc-400"
          />
          <StatCard
            label="High leverage"
            value={stats.highLeverage}
            href={buildRoadmapHref({ statusTagFilterIds: ["high_leverage"] })}
            icon={Rocket}
            accentClass="bg-emerald-500/15 text-emerald-400"
          />
          <StatCard
            label="Time-sensitive idle"
            value={stats.timeSensitive}
            hint="High cost of delay, not In Progress"
            href={buildRoadmapHref({ statusTagFilterIds: ["time_sensitive"] })}
            icon={Timer}
            accentClass="bg-yellow-500/15 text-yellow-400"
          />
        </div>
      </section>

      {/* Attention Samples */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-4">
          Needs attention
        </h2>
        {attentionSamples.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-6 py-8 text-center">
            <Zap className="h-6 w-6 text-emerald-500/60 mx-auto mb-2" />
            <p className="text-sm text-zinc-400">
              No P0 blocked, zombies, or at-risk projects. Looking good!
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden divide-y divide-zinc-800/60">
            {attentionSamples.map((item) => {
              const company = companyById.get(item.companyId);
              const href = buildRoadmapHref({
                focus: { goalId: item.goalId, projectId: item.projectId },
              });
              return (
                <Link
                  key={item.key}
                  href={href}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-800/30 group/row focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-500"
                  aria-label={`Open project ${item.label} on Roadmap`}
                >
                  {company ? (
                    <CompanyLogo company={company} size="sm" />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-200 truncate group-hover/row:text-zinc-50">
                      {item.label}
                    </p>
                    <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                      {item.sub}
                    </p>
                  </div>
                  <AttentionBadge kind={item.kind} />
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-zinc-600 opacity-0 transition-opacity group-hover/row:opacity-100"
                    aria-hidden
                  />
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Upcoming deadlines */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-4">
          Upcoming &amp; overdue deadlines
        </h2>
        {upcomingDeadlines.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-6 py-8 text-center">
            <CalendarClock className="h-6 w-6 text-zinc-600 mx-auto mb-2" />
            <p className="text-sm text-zinc-500">
              No project or milestone target dates set yet.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden divide-y divide-zinc-800/60">
            {upcomingDeadlines.map((row) => {
              const company = companyById.get(row.companyId);
              const href = buildRoadmapHref({
                focus: { goalId: row.goalId, projectId: row.projectId },
              });
              return (
                <Link
                  key={row.id}
                  href={href}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-800/30 group/dl focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-500"
                  aria-label={`Open ${row.title} on Roadmap`}
                >
                  {company ? (
                    <CompanyLogo company={company} size="sm" />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-200 truncate group-hover/dl:text-zinc-50">
                      {row.title}
                    </p>
                    <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                      {row.sub} · {formatRelativeCalendarDate(row.dateYmd)}
                    </p>
                  </div>
                  <DueChip diffDays={row.diffDays} />
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-zinc-600 opacity-0 transition-opacity group-hover/dl:opacity-100"
                    aria-hidden
                  />
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Company Momentum */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-4">
          Company momentum
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {hierarchy.map((company) => {
            const s = companyStatsByCompanyId[company.id];
            const score = s?.momentumScore ?? 0;
            const milestonePct =
              s && s.milestonesTotal > 0
                ? Math.min(
                    100,
                    Math.round((s.milestonesDone / s.milestonesTotal) * 100)
                  )
                : 0;
            const companyHref = buildRoadmapHref({
              companyFilterIds: [company.id],
            });
            return (
              <Link
                key={company.id}
                href={companyHref}
                className="block rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-4 transition-colors hover:border-zinc-600 hover:bg-zinc-900/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 group/cm"
                aria-label={`Open Roadmap filtered to ${company.name}`}
              >
                <div className="flex items-center gap-3 mb-3">
                  <CompanyLogo company={company} size="lg" />
                  <div className="min-w-0 flex-1">
                    <span className="font-semibold text-zinc-100 text-sm block truncate group-hover/cm:text-white">
                      {company.name}
                    </span>
                    {s ? (
                      <span className="text-[11px] text-zinc-500 mt-0.5 block">
                        {s.goals} goal{s.goals !== 1 ? "s" : ""} · {s.projects}{" "}
                        project{s.projects !== 1 ? "s" : ""} · {s.owners} owner
                        {s.owners !== 1 ? "s" : ""}
                      </span>
                    ) : null}
                  </div>
                  <span className="text-lg font-bold tabular-nums text-zinc-300 shrink-0">
                    {score}
                  </span>
                </div>
                {s && s.milestonesTotal > 0 ? (
                  <div className="mb-3">
                    <div className="flex justify-between text-[11px] text-zinc-500 mb-1">
                      <span>Milestones</span>
                      <span className="tabular-nums text-zinc-400">
                        {s.milestonesDone}/{s.milestonesTotal}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500/80 transition-[width]"
                        style={{ width: `${milestonePct}%` }}
                      />
                    </div>
                  </div>
                ) : null}
                <MomentumBar score={score} />
              </Link>
            );
          })}
        </div>
      </section>

      {/* Heaviest Project Loads */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-4">
          Heaviest project loads
        </h2>
        {topLoaded.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-6 py-8 text-center">
            <Clock className="h-6 w-6 text-zinc-600 mx-auto mb-2" />
            <p className="text-sm text-zinc-500">
              No project owners in workload data.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden divide-y divide-zinc-800/60">
            {            topLoaded.map((w, idx) => {
              const companyLogos = w.projectCompanyIds
                .slice(0, 4)
                .map((cId) => companyById.get(cId))
                .filter(Boolean) as CompanyWithGoals[];

              const ownerHref = buildRoadmapHref({
                ownerFilterIds: [w.person.id],
              });

              return (
                <Link
                  key={w.person.id}
                  href={ownerHref}
                  className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-zinc-800/30 group/wl focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-500"
                  aria-label={`Open Roadmap filtered to ${w.person.name}`}
                >
                  <span className="text-xs font-medium tabular-nums text-zinc-600 w-4 text-right shrink-0">
                    {idx + 1}
                  </span>
                  <PersonAvatar person={w.person} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-zinc-200 truncate">
                        {w.person.name}
                      </span>
                      {companyLogos.length > 0 ? (
                        <span className="flex items-center gap-1.5 shrink-0">
                          {companyLogos.map((c) => (
                            <span
                              key={c.id}
                              className="ring-2 ring-zinc-900 rounded-md"
                            >
                              <CompanyLogo company={c} size="sm" />
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </div>
                    {w.person.role?.trim() ? (
                      <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                        {w.person.role}
                      </p>
                    ) : null}
                    <div className="mt-2">
                      <WorkloadBar
                        totalProjects={w.totalProjects}
                        p0Projects={w.p0Projects}
                        p1Projects={w.p1Projects}
                        maxAcrossTeam={maxLoad}
                      />
                    </div>
                  </div>
                  <div className="text-right shrink-0 pl-2 flex items-center gap-2">
                    <div>
                      <span className="text-lg font-bold tabular-nums text-zinc-200">
                        {w.totalProjects}
                      </span>
                      <p className="text-[10px] text-zinc-500">projects</p>
                    </div>
                    <ChevronRight
                      className="h-4 w-4 text-zinc-600 opacity-0 transition-opacity group-hover/wl:opacity-100"
                      aria-hidden
                    />
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* Workload legend */}
        {topLoaded.length > 0 ? (
          <div className="flex items-center gap-4 mt-3 text-[11px] text-zinc-500">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-red-500/85" />
              P0
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-orange-500/80" />
              P1
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-sky-600/70" />
              Other
            </span>
          </div>
        ) : null}
      </section>
    </div>
  );
}
