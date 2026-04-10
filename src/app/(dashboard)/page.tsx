import { getHierarchy, getPeople } from "@/server/actions/tracker";
import { TrackerView } from "@/components/tracker/TrackerView";

export default async function RoadmapPage() {
  const [hierarchy, people] = await Promise.all([
    getHierarchy(),
    getPeople(),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-zinc-100">Roadmap</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Company → Goal → Project → Milestone.
        </p>
      </div>

      <TrackerView hierarchy={hierarchy} people={people} />
    </div>
  );
}
