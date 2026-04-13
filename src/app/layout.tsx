import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Executive Command Center",
  description: "MLabs Roadmap — portfolio goals, projects, and milestones",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark h-full">
      {/*
        h-full + overflow-hidden: single scroll region (dashboard main), not the document.
        Login and other full-page routes use min-h-full + overflow-y-auto on their root.
      */}
      <body className="h-full min-h-0 overflow-hidden antialiased">
        {children}
        <Toaster theme="dark" richColors position="bottom-right" />
      </body>
    </html>
  );
}
