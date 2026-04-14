export type AssistantEntityOption = {
  type: "company" | "goal" | "project" | "milestone";
  id: string;
  label: string;
  subtitle?: string;
};

export type AssistantEntitiesBundle = {
  companies: AssistantEntityOption[];
  goals: AssistantEntityOption[];
  projects: AssistantEntityOption[];
  milestones: AssistantEntityOption[];
};
