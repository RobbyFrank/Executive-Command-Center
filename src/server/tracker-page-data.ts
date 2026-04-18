import { unstable_cache } from "next/cache";
import { getRepository } from "@/server/repository";
import { ECC_TRACKER_DATA_TAG } from "@/lib/cache-tags";
import type { CompanyDirectoryStats } from "@/lib/types/tracker";

const trackerTag = { tags: [ECC_TRACKER_DATA_TAG] };

/** Roadmap page: company → goal → project tree. */
export const getCachedHierarchy = unstable_cache(
  async () => getRepository().getHierarchy(),
  ["ecc-page-hierarchy"],
  trackerTag
);

/** Shared people list (Roadmap owner pickers, Team). */
export const getCachedPeople = unstable_cache(
  async () => getRepository().getPeople(),
  ["ecc-page-people"],
  trackerTag
);

/** Companies directory rows. */
export const getCachedCompanies = unstable_cache(
  async () => getRepository().getCompanies(),
  ["ecc-page-companies"],
  trackerTag
);

/** Team page workloads. */
export const getCachedPersonWorkloads = unstable_cache(
  async () => getRepository().getPersonWorkloads(),
  ["ecc-page-workloads"],
  trackerTag
);

/** Companies page momentum / stats columns. */
export const getCachedCompanyStatsByCompanyId = unstable_cache(
  async (): Promise<Record<string, CompanyDirectoryStats>> =>
    getRepository().getCompanyStatsByCompanyId(),
  ["ecc-page-company-stats"],
  trackerTag
);
