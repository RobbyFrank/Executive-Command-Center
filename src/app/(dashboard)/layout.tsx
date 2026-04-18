import { cookies } from "next/headers";
import { getSession } from "@/server/auth";
import { getRepository } from "@/server/repository";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/tracker/Sidebar";
import { AiAssistantButton } from "@/components/ai-assistant/AiAssistantButton";
import { AssistantProvider } from "@/contexts/AssistantContext";
import { SIDEBAR_COLLAPSED_PREF_KEY } from "@/lib/sidebar-prefs";

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

  const cookieStore = await cookies();
  const initialSidebarCollapsed =
    cookieStore.get(SIDEBAR_COLLAPSED_PREF_KEY)?.value === "true";

  return (
    <AssistantProvider>
      <div className="flex h-full min-h-0 overflow-hidden">
        <Sidebar
          displayName={sidebarDisplayName}
          initialCollapsed={initialSidebarCollapsed}
        />
        <main className="min-h-0 min-w-0 flex-1 overflow-auto px-6 pb-6 pt-0">
          {children}
        </main>
        <AiAssistantButton />
      </div>
    </AssistantProvider>
  );
}
