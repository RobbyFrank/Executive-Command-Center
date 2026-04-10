import { getHierarchy, getPeople } from "@/server/actions/tracker";
import { MatrixView } from "@/components/tracker/MatrixView";

export default async function MatrixPage() {
  const [hierarchy, people] = await Promise.all([
    getHierarchy(),
    getPeople(),
  ]);

  return (
    <div className="-mx-6 -mb-6 min-h-0">
      <MatrixView hierarchy={hierarchy} people={people} />
    </div>
  );
}
