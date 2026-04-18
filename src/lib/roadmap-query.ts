import type { Priority } from "@/lib/types/tracker";
import { DELIVERY_STATUS_FILTER_OPTIONS } from "@/lib/projectStatus";
import type {
  DueDateFilterId,
  TrackerStatusTagId,
} from "@/lib/tracker-search-filter";
import { DUE_DATE_FILTER_OPTIONS } from "@/lib/tracker-search-filter";

const DELIVERY_STATUSES = new Set<string>(DELIVERY_STATUS_FILTER_OPTIONS);
const PRIORITIES = new Set<Priority>(["P0", "P1", "P2", "P3"]);

const TRACKER_STATUS_TAGS: readonly TrackerStatusTagId[] = [
  "at_risk",
  "unassigned",
  "zombie",
  "stalled",
] as const;
const TAG_SET = new Set<string>(TRACKER_STATUS_TAGS);

const DUE_IDS = new Set<DueDateFilterId>(
  DUE_DATE_FILTER_OPTIONS.map((o) => o.id)
);

function firstString(
  sp: Record<string, string | string[] | undefined>,
  key: string
): string | undefined {
  const v = sp[key];
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return v[0];
  return v;
}

function splitCsv(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parsed Roadmap (`/`) filters; empty arrays mean “no filter” for that dimension. */
export interface RoadmapInitialFilters {
  companyFilterIds: string[];
  ownerFilterIds: string[];
  statusTagFilterIds: TrackerStatusTagId[];
  dueDateFilterIds: DueDateFilterId[];
  priorityFilterIds: string[];
  statusEnumFilterIds: string[];
  searchQuery: string;
}

export function emptyRoadmapFilters(): RoadmapInitialFilters {
  return {
    companyFilterIds: [],
    ownerFilterIds: [],
    statusTagFilterIds: [],
    dueDateFilterIds: [],
    priorityFilterIds: [],
    statusEnumFilterIds: [],
    searchQuery: "",
  };
}

function filterAllowed<T extends string>(items: string[], allowed: Set<T>): T[] {
  const out: T[] = [];
  for (const x of items) {
    if (allowed.has(x as T)) out.push(x as T);
  }
  return out;
}

export type ParsedRoadmapQuery = {
  initialFocus?: { goalId: string; projectId: string };
  filters: RoadmapInitialFilters;
};

/**
 * Read Roadmap URL search params (server or client). Unknown tokens are dropped.
 */
export function parseRoadmapSearchParams(
  sp: Record<string, string | string[] | undefined>
): ParsedRoadmapQuery {
  const focusGoal = firstString(sp, "focusGoal")?.trim();
  const focusProject = firstString(sp, "focusProject")?.trim();
  const initialFocus =
    focusGoal && focusProject
      ? { goalId: focusGoal, projectId: focusProject }
      : undefined;

  const companies = splitCsv(firstString(sp, "companies"));
  const owners = splitCsv(firstString(sp, "owners"));
  const tagsRaw = splitCsv(firstString(sp, "tags"));
  const tags = tagsRaw.filter((t): t is TrackerStatusTagId => TAG_SET.has(t));

  const prioritiesRaw = splitCsv(firstString(sp, "priorities"));
  const priorityFilterIds = prioritiesRaw.filter((p) => PRIORITIES.has(p as Priority));

  const deliveryRaw = splitCsv(firstString(sp, "delivery"));
  const statusEnumFilterIds = deliveryRaw.filter((s) =>
    DELIVERY_STATUSES.has(s)
  );

  const dueRaw = splitCsv(firstString(sp, "due"));
  const dueDateFilterIds = filterAllowed(dueRaw, DUE_IDS);

  const q = firstString(sp, "q")?.trim() ?? "";

  return {
    initialFocus,
    filters: {
      companyFilterIds: companies,
      ownerFilterIds: owners,
      statusTagFilterIds: tags,
      dueDateFilterIds,
      priorityFilterIds,
      statusEnumFilterIds,
      searchQuery: q,
    },
  };
}

export type RoadmapLinkBuild = Partial<RoadmapInitialFilters> & {
  focus?: { goalId: string; projectId: string };
};

/**
 * Build a `/?…` href for the Roadmap with optional filters and/or project focus.
 */
export function buildRoadmapHref(options: RoadmapLinkBuild): string {
  const q = new URLSearchParams();

  if (options.focus?.goalId && options.focus?.projectId) {
    q.set("focusGoal", options.focus.goalId);
    q.set("focusProject", options.focus.projectId);
  }

  const join = (ids: string[] | undefined) =>
    ids && ids.length > 0 ? ids.join(",") : "";

  const companies = join(options.companyFilterIds);
  if (companies) q.set("companies", companies);

  const owners = join(options.ownerFilterIds);
  if (owners) q.set("owners", owners);

  const tags = join(options.statusTagFilterIds as string[]);
  if (tags) q.set("tags", tags);

  const priorities = join(options.priorityFilterIds);
  if (priorities) q.set("priorities", priorities);

  const delivery = join(options.statusEnumFilterIds);
  if (delivery) q.set("delivery", delivery);

  const due = join(options.dueDateFilterIds as string[]);
  if (due) q.set("due", due);

  if (options.searchQuery?.trim()) q.set("q", options.searchQuery.trim());

  const s = q.toString();
  return s ? `/?${s}` : "/";
}
