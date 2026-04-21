export type AssistantEntityOption = {
  type: "company" | "goal" | "project" | "milestone";
  id: string;
  label: string;
  subtitle?: string;
};

/** Roster row for rendering names in assistant answers (avatar + label). */
export type AssistantPersonRef = {
  id: string;
  name: string;
  profilePicturePath?: string | null;
};

export type AssistantEntitiesBundle = {
  /** Tracker document revision — bumps on any roadmap mutation; used for client caches. */
  revision: number;
  companies: AssistantEntityOption[];
  goals: AssistantEntityOption[];
  projects: AssistantEntityOption[];
  milestones: AssistantEntityOption[];
  people: AssistantPersonRef[];
};
