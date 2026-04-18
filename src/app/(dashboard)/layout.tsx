import { cookies } from "next/headers";
import { getSession } from "@/server/auth";
import { getRepository } from "@/server/repository";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/tracker/Sidebar";
import { AiAssistantButton } from "@/components/ai-assistant/AiAssistantButton";
import { AssistantProvider } from "@/contexts/AssistantContext";
import { getSidebarCollapsedFromCookie } from "@/lib/sidebar-prefs";

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

  return (
    <AssistantProvider>
      <div className="flex h-full min-h-0 overflow-hidden">
        <Sidebar
          displayName={sidebarDisplayName}
          profilePicturePath={sidebarProfilePicturePath}
          initialCollapsed={initialSidebarCollapsed}
        />
        <main className="relative min-h-0 min-w-0 flex-1 overflow-auto px-6 pb-6 pt-0">
          {/* Barely-there brand wash behind content — echoes login aurora without competing with the UI */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-0 h-56 bg-[radial-gradient(ellipse_75%_100%_at_50%_-10%,rgba(16,185,129,0.055),transparent_65%)]"
            aria-hidden
          />
          <div className="relative z-10 min-h-0">{children}</div>
        </main>
        <AiAssistantButton />
      </div>
    </AssistantProvider>
  );
}
