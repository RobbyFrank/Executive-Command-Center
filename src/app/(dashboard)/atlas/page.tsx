import {
  getCachedHierarchy,
  getCachedPeople,
} from "@/server/tracker-page-data";
import { PortfolioAtlas } from "@/components/atlas/PortfolioAtlas";

// Tracker data is loaded from Redis at request time (same as the Roadmap page).
// Opt out of static rendering so the build doesn't try to prerender without KV.
export const dynamic = "force-dynamic";

export default async function AtlasPage() {
  const [hierarchy, people] = await Promise.all([
    getCachedHierarchy(),
    getCachedPeople(),
  ]);

  return (
    <div className="-mx-6 -mb-6 h-[100dvh] min-h-0 min-w-0 overflow-hidden">
      <PortfolioAtlas hierarchy={hierarchy} people={people} />
    </div>
  );
}
