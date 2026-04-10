import { getSession } from "@/server/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/tracker/Sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="flex h-screen">
      <Sidebar username={session.username} />
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
