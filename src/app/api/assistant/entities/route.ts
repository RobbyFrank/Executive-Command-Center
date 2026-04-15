import type {
  AssistantEntityOption,
} from "@/lib/types/assistant-entities";
import { getRepository } from "@/server/repository";

export type { AssistantEntityOption } from "@/lib/types/assistant-entities";

export async function GET() {
  const repo = getRepository();
  const data = await repo.load();

  const companies: AssistantEntityOption[] = data.companies.map((c) => ({
    type: "company" as const,
    id: c.id,
    label: c.name,
    subtitle:
      c.shortName && c.shortName !== c.name ? c.shortName : undefined,
  }));

  const goals: AssistantEntityOption[] = data.goals.map((g) => {
    const company = data.companies.find((c) => c.id === g.companyId);
    return {
      type: "goal" as const,
      id: g.id,
      label: g.description,
      subtitle: company
        ? `${company.shortName || company.name}`
        : undefined,
    };
  });

  const projects: AssistantEntityOption[] = data.projects.map((p) => {
    const goal = data.goals.find((g) => g.id === p.goalId);
    const company = goal
      ? data.companies.find((c) => c.id === goal.companyId)
      : undefined;
    const bits = [goal?.description, company?.shortName || company?.name].filter(
      Boolean,
    ) as string[];
    return {
      type: "project" as const,
      id: p.id,
      label: p.name,
      subtitle: bits.length ? bits.join(" · ") : undefined,
    };
  });

  const milestones: AssistantEntityOption[] = data.milestones.map((m) => {
    const proj = data.projects.find((p) => p.id === m.projectId);
    return {
      type: "milestone" as const,
      id: m.id,
      label: m.name,
      subtitle: proj?.name,
    };
  });

  const people = data.people.map((p) => ({
    id: p.id,
    name: p.name,
    profilePicturePath: p.profilePicturePath?.trim() || null,
  }));

  return Response.json(
    { companies, goals, projects, milestones, people },
    { headers: { "Cache-Control": "no-store" } },
  );
}
