import type { Metadata } from "next";
import {
  getCachedCompanies,
  getCachedPeople,
} from "@/server/tracker-page-data";
import { getCachedSlackPendingStats } from "@/server/slack-suggestions-stats";
import { sortCompaniesByRevenueDesc } from "@/lib/companySort";
import { SlackSyncPage } from "@/components/sync/SlackSyncPage";

export const metadata: Metadata = {
  title: "Slack Sync",
};

export default async function SyncPage() {
  const [people, slackPending, companies] = await Promise.all([
    getCachedPeople(),
    getCachedSlackPendingStats(),
    getCachedCompanies(),
  ]);

  return (
    <SlackSyncPage
      people={people}
      companies={sortCompaniesByRevenueDesc(companies).map((c) => ({
        id: c.id,
        name: c.name,
        logoPath: c.logoPath ?? "",
        pinned: c.pinned ?? false,
      }))}
      slackPendingByCompany={slackPending.byCompany}
    />
  );
}
