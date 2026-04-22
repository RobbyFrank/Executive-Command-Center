import { cookies } from "next/headers";
import { getSession } from "@/server/auth";
import { getRepository } from "@/server/repository";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/tracker/Sidebar";
import { AiAssistantButton } from "@/components/ai-assistant/AiAssistantButton";
import { AssistantProvider } from "@/contexts/AssistantContext";
import { DashboardAmbientBackground } from "@/components/brand/DashboardAmbientBackground";
import { getSidebarCollapsedFromCookie } from "@/lib/sidebar-prefs";
import { getCachedPeople, getCachedProjects } from "@/server/tracker-page-data";
import { calendarDateTodayLocal } from "@/lib/relativeCalendarDate";
import { countUnattendedNewHires } from "@/lib/onboarding";
import { getUnrepliedAsksOpenCount } from "@/server/actions/unrepliedAsks";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const person = await getRepository().getPerson(session.personId);
  const sidebarDisplayName =
    (person?.name ?? "").trim() || session.email;
  const sidebarProfilePicturePath =
    person?.profilePicturePath?.trim() || undefined;

  const cookieStore = await cookies();
  const initialSidebarCollapsed = getSidebarCollapsedFromCookie(cookieStore);

  const [people, projects] = await Promise.all([
    getCachedPeople(),
    getCachedProjects(),
  ]);
  const todayYmd = calendarDateTodayLocal();
  const unattendedNewHireCount = countUnattendedNewHires(
    people,
    projects,
    todayYmd
  );
  const unrepliedAsksCount = await getUnrepliedAsksOpenCount();

  return (
    <AssistantProvider>
      {/*
        Ambient background is rendered at the viewport root (fixed) so it stays
        visible as the main content scrolls. The login page uses a richer
        aurora; here we use a much subtler wash that lifts the page off
        pitch-black without competing with dense tracker UI. The pointer-
        tracked spotlight lives in DashboardAmbientBackground (client).
      */}
      <DashboardAmbientBackground />

      <div className="relative z-10 flex h-full min-h-0 overflow-hidden">
        <Sidebar
          displayName={sidebarDisplayName}
          profilePicturePath={sidebarProfilePicturePath}
          initialCollapsed={initialSidebarCollapsed}
          unattendedNewHireCount={unattendedNewHireCount}
          unrepliedAsksCount={unrepliedAsksCount}
        />
        <main className="relative min-h-0 min-w-0 flex-1 overflow-auto px-6 pb-6 pt-0">
          <div className="relative z-10 min-h-0">{children}</div>
        </main>
        <AiAssistantButton />
      </div>
    </AssistantProvider>
  );
}
