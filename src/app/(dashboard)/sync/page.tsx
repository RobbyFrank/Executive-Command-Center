import type { Metadata } from "next";
import {
  getCachedCompanies,
  getCachedHierarchy,
  getCachedPeople,
} from "@/server/tracker-page-data";
import { getCachedSlackPendingStats } from "@/server/slack-suggestions-stats";
import { sortCompaniesByRevenueDesc } from "@/lib/companySort";
import { SlackSyncPage } from "@/components/sync/SlackSyncPage";

export const metadata: Metadata = {
  title: "Slack Sync",
};

export default async function SyncPage() {
  const [people, slackPending, companies, hierarchy] = await Promise.all([
    getCachedPeople(),
    getCachedSlackPendingStats(),
    getCachedCompanies(),
    getCachedHierarchy(),
  ]);

  // Lookup tables so the review queue can show "New project: X (in goal: Y)"
  // and "Add milestone: Z (project: …)" without re-fetching on the client.
  const goalNamesById: Record<string, string> = {};
  const projectGoalById: Record<string, { projectName: string; goalName: string }> = {};
  for (const c of hierarchy) {
    for (const g of c.goals) {
      goalNamesById[g.id] = g.description;
      for (const p of g.projects) {
        projectGoalById[p.id] = {
          projectName: p.name,
          goalName: g.description,
        };
      }
    }
  }

  return (
    <SlackSyncPage
      people={people}
      companies={sortCompaniesByRevenueDesc(companies).map((c) => ({
        id: c.id,
        name: c.name,
        shortName: c.shortName,
        revenue: c.revenue,
        logoPath: c.logoPath ?? "",
        pinned: c.pinned ?? false,
      }))}
      slackPendingByCompany={slackPending.byCompany}
      goalNamesById={goalNamesById}
      projectGoalById={projectGoalById}
    />
  );
}
