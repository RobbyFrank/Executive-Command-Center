import {
  getCachedHierarchy,
  getCachedPeople,
} from "@/server/tracker-page-data";
import { TrackerView } from "@/components/tracker/TrackerView";
import { parseRoadmapSearchParams } from "@/lib/roadmap-query";

export default async function RoadmapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { initialFocus, filters: initialFilters } = parseRoadmapSearchParams(sp);

  const [hierarchy, people] = await Promise.all([
    getCachedHierarchy(),
    getCachedPeople(),
  ]);

  return (
    <div className="-mx-6 -mb-6 min-h-0 min-w-0">
      <TrackerView
        hierarchy={hierarchy}
        people={people}
        initialFocus={initialFocus}
        initialFilters={initialFilters}
      />
    </div>
  );
}
