import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Portfolio OS",
  description: "MLabs Portfolio OS — portfolio goals, projects, and milestones",
  icons: {
    icon: [
      { url: "/icons/favicon.ico", sizes: "any" },
      {
        url: "/icons/favicon-16x16.png",
        sizes: "16x16",
        type: "image/png",
      },
      {
        url: "/icons/favicon-32x32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/icons/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        url: "/icons/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
    shortcut: "/icons/favicon.ico",
  },
  manifest: "/icons/site.webmanifest",
  appleWebApp: {
    title: "Portfolio OS",
  },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`dark h-full ${inter.variable}`}
      suppressHydrationWarning
    >
      {/*
        h-full + overflow-hidden: single scroll region (dashboard main), not the document.
        Login and other full-page routes use min-h-full + overflow-y-auto on their root.
      */}
      <body
        className={`h-full min-h-0 overflow-hidden antialiased ${inter.className}`}
        suppressHydrationWarning
      >
        {children}
        <Toaster theme="dark" richColors position="bottom-right" />
      </body>
    </html>
  );
}
