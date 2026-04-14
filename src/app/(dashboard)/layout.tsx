import { getSession } from "@/server/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/tracker/Sidebar";
import { AiAssistantButton } from "@/components/ai-assistant/AiAssistantButton";
import { AssistantProvider } from "@/contexts/AssistantContext";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <AssistantProvider>
      <div className="flex h-full min-h-0 overflow-hidden">
        <Sidebar username={session.username} />
        <main className="min-h-0 min-w-0 flex-1 overflow-auto px-6 pb-6 pt-0">
          {children}
        </main>
        <AiAssistantButton />
      </div>
    </AssistantProvider>
  );
}
