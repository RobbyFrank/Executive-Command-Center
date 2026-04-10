"use client";

import { useMemo } from "react";
import type { Company, Person, PersonWorkload } from "@/lib/types/tracker";
import {
  buildTeamRosterDisplayGroups,
  AUTONOMY_GROUP_LABEL,
  AUTONOMY_GROUP_VISUAL,
  FOUNDER_GROUP_LABEL,
  FOUNDER_GROUP_VISUAL,
  FOUNDERS_DEPARTMENT,
  isFounderPersonId,
} from "@/lib/autonomyRoster";
import { DepartmentOptionIcon } from "@/lib/departmentIcons";
import { cn } from "@/lib/utils";
import { InlineEditCell } from "./InlineEditCell";
import { ScoreCell } from "./ScoreCell";
import { ConfirmDeletePopover } from "./ConfirmDeletePopover";
import { LocalImageField } from "./LocalImageField";
import { CompanyAffiliationLogos } from "./CompanyAffiliationLogos";
import {
  createPerson,
  updatePerson,
  deletePerson,
} from "@/server/actions/tracker";
import { departmentSelectOptions } from "@/lib/trackerDepartmentOptions";
import { DepartmentSelect } from "./DepartmentSelect";
import { EmploymentToggle } from "./EmploymentToggle";
import { Plus } from "lucide-react";
import { SlackLogo } from "./SlackLogo";
import { WorkloadBar } from "./WorkloadBar";

interface TeamRosterManagerProps {
  initialPeople: Person[];
  companies: Company[];
  workloads: PersonWorkload[];
}

export function TeamRosterManager({
  initialPeople,
  companies,
  workloads,
}: TeamRosterManagerProps) {
  const people = initialPeople;
  const workloadByPersonId = useMemo(() => {
    const m = new Map<string, PersonWorkload>();
    for (const w of workloads) m.set(w.person.id, w);
    return m;
  }, [workloads]);
  const rosterGroups = useMemo(
    () => buildTeamRosterDisplayGroups(people),
    [people]
  );

  const departmentOptionsByPersonId = useMemo(() => {
    const m = new Map<string, { value: string; label: string }[]>();
    for (const p of people) {
      if (isFounderPersonId(p.id)) continue;
      m.set(
        p.id,
        departmentSelectOptions(people, p.department ?? "", p.id)
      );
    }
    return m;
  }, [people]);

  const maxWorkloadAcrossTeam = useMemo(
    () =>
      workloads.reduce((m, w) => Math.max(m, w.totalProjects), 0),
    [workloads]
  );

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900/40 rounded-lg border border-zinc-800 overflow-x-auto">
        <table className="w-full text-sm min-w-[1040px]">
          <thead>
            <tr className="border-b border-zinc-800 text-xs text-zinc-500">
              <th
                className="text-left px-3 py-3 font-medium min-w-[220px]"
                scope="col"
              >
                Member
              </th>
              <th className="text-left px-3 py-3 font-medium">Role</th>
              <th className="text-left px-3 py-3 font-medium min-w-[120px]">
                Department
              </th>
              <th className="text-left px-3 py-3 font-medium whitespace-nowrap">
                Team
              </th>
              <th className="text-left px-3 py-3 font-medium whitespace-nowrap">
                Join date
              </th>
              <th className="text-left px-3 py-3 font-medium">Autonomy</th>
              <th className="text-left px-3 py-3 font-medium min-w-[220px]">
                Workload
              </th>
              <th className="text-left px-3 py-3 font-medium min-w-[160px]">
                Companies
              </th>
              <th className="text-left px-3 py-3 font-medium" scope="col">
                <SlackLogo alt="Slack" className="h-4 w-4" />
              </th>
              <th className="w-10" />
            </tr>
          </thead>
          {rosterGroups.map((group) => {
            const isFounders = group.kind === "founders";
            const visual = isFounders
              ? FOUNDER_GROUP_VISUAL
              : AUTONOMY_GROUP_VISUAL[group.level];
            const label = isFounders
              ? FOUNDER_GROUP_LABEL
              : AUTONOMY_GROUP_LABEL[group.level];
            const groupPeople = group.people;
            return (
              <tbody key={isFounders ? "__founders__" : group.level}>
                <tr className={visual.header}>
                  <td colSpan={10} className="px-3 py-2.5">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <span className="text-sm font-semibold text-zinc-100 tracking-tight">
                        {label.title}
                      </span>
                      {label.hint ? (
                        <span className="text-xs text-zinc-400">{label.hint}</span>
                      ) : null}
                    </div>
                  </td>
                </tr>
                {groupPeople.map((person) => {
                  const w = workloadByPersonId.get(person.id);
                  return (
                  <tr
                    key={person.id}
                    className={cn(
                      visual.dataRow,
                      "border-b border-zinc-800/60 group align-top"
                    )}
                  >
                    <td className="px-3 py-2 align-top">
                      <div className="flex items-start gap-3 min-w-0 max-w-[280px]">
                        <div className="shrink-0">
                          <LocalImageField
                            variant="person"
                            entityId={person.id}
                            path={person.profilePicturePath ?? ""}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <InlineEditCell
                            value={person.name}
                            onSave={(name) => updatePerson(person.id, { name })}
                            displayClassName="text-zinc-200"
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 max-w-[140px]">
                      <InlineEditCell
                        value={person.role}
                        onSave={(role) => updatePerson(person.id, { role })}
                        displayClassName="text-zinc-400"
                      />
                    </td>
                    <td className="px-3 py-2 max-w-[160px]">
                      {isFounderPersonId(person.id) ? (
                        <div className="flex min-w-0 max-w-[220px] items-center gap-2 px-2 py-1.5">
                          <DepartmentOptionIcon
                            label={FOUNDERS_DEPARTMENT}
                            className="opacity-90"
                          />
                          <span className="min-w-0 truncate text-sm font-medium text-zinc-300">
                            {FOUNDERS_DEPARTMENT}
                          </span>
                        </div>
                      ) : (
                        <DepartmentSelect
                          value={person.department ?? ""}
                          options={
                            departmentOptionsByPersonId.get(person.id) ?? [
                              { value: "", label: "No department" },
                            ]
                          }
                          onChange={(department) =>
                            updatePerson(person.id, { department })
                          }
                          aria-label="Department"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {isFounderPersonId(person.id) ? (
                        <span className="text-sm text-zinc-600">—</span>
                      ) : (
                        <EmploymentToggle
                          outsourced={person.outsourced}
                          onChange={(outsourced) =>
                            updatePerson(person.id, { outsourced })
                          }
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 max-w-[120px] whitespace-nowrap">
                      {isFounderPersonId(person.id) ? (
                        <span
                          className="text-sm text-zinc-400 font-medium"
                          title="Founder"
                        >
                          OG
                        </span>
                      ) : (
                        <InlineEditCell
                          type="date"
                          value={person.joinDate}
                          onSave={(joinDate) =>
                            updatePerson(person.id, { joinDate })
                          }
                          displayClassName="text-zinc-400"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {isFounderPersonId(person.id) ? (
                        <span className="text-sm text-zinc-600">—</span>
                      ) : (
                        <ScoreCell
                          value={person.autonomyScore}
                          onSave={(autonomyScore) =>
                            updatePerson(person.id, { autonomyScore })
                          }
                          colorScale="autonomy"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <WorkloadBar
                        totalProjects={w?.totalProjects ?? 0}
                        p0Projects={w?.p0Projects ?? 0}
                        p1Projects={w?.p1Projects ?? 0}
                        maxAcrossTeam={maxWorkloadAcrossTeam}
                      />
                    </td>
                    <td className="px-3 py-2 max-w-[280px]">
                      {isFounderPersonId(person.id) ? (
                        <span className="text-zinc-400">All</span>
                      ) : (
                        <CompanyAffiliationLogos
                          shortListCsv={w?.projectCompanyIds?.join(",") ?? ""}
                          companies={companies}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 max-w-[120px]">
                      <InlineEditCell
                        value={person.slackHandle}
                        onSave={(slackHandle) =>
                          updatePerson(person.id, { slackHandle })
                        }
                        displayClassName="text-zinc-500"
                      />
                    </td>
                    <td className="px-1 py-2">
                      {isFounderPersonId(person.id) ? null : (
                        <ConfirmDeletePopover
                          entityName={person.name}
                          onConfirm={() => deletePerson(person.id)}
                        />
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>

      <button
        type="button"
        onClick={() =>
          createPerson({
            name: "New team member",
            role: "",
            department: "",
            autonomyScore: 3,
            slackHandle: "",
            profilePicturePath: "",
            joinDate: "",
            outsourced: false,
          })
        }
        className="flex items-center gap-2 px-4 py-3 text-sm text-zinc-600 hover:text-zinc-400 transition-colors w-full border border-dashed border-zinc-800 rounded-lg hover:border-zinc-700"
      >
        <Plus className="h-4 w-4" />
        Add team member
      </button>
    </div>
  );
}
