import { getHierarchy, getPeople } from "@/server/actions/tracker";
import { ReviewMode } from "@/components/tracker/ReviewMode";

export default async function ReviewPage() {
  const [hierarchy, people] = await Promise.all([
    getHierarchy(),
    getPeople(),
  ]);

  return (
    <div className="-mx-6 -mb-6 min-h-0">
      <ReviewMode hierarchy={hierarchy} people={people} />
    </div>
  );
}
