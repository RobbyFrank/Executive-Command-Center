import type { Metadata } from "next";
import { getCachedPeople } from "@/server/tracker-page-data";
import { getUnrepliedAsksSnapshot } from "@/server/actions/unrepliedAsks";
import { UnrepliedAsksView } from "@/components/unreplied/UnrepliedAsksView";

export const metadata: Metadata = {
  title: "Followups",
};

export default async function UnrepliedPage() {
  const people = await getCachedPeople();
  const snapshot = await getUnrepliedAsksSnapshot(people);

  return (
    <UnrepliedAsksView
      snapshot={snapshot}
      people={people}
    />
  );
}
