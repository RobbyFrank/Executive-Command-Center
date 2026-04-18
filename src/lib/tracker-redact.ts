import type { TrackerData } from "@/lib/types/tracker";

/**
 * Strips salary and direct contact fields before sending tracker JSON to LLM
 * prompts. Names, departments, Slack user ids (for mention UX), and roadmap
 * content are kept.
 */
export function redactTrackerForAi(data: TrackerData): TrackerData {
  return {
    ...data,
    people: data.people.map((p) => ({
      ...p,
      email: "",
      phone: "",
      estimatedMonthlySalary: 0,
      passwordHash: "",
    })),
  };
}
