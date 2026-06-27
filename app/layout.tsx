import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import AppHeader from "@/components/AppHeader";
import AuthSessionProvider from "@/components/AuthSessionProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "EntreTangle",
  description:
    "Agent teams research your business brief and converge into a queryable world model.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Allow users to zoom (accessibility) while keeping a sensible default.
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex h-screen flex-col">
        <AuthSessionProvider>
          <Suspense fallback={<div className="h-12 shrink-0 border-b border-neutral-200" />}>
            <AppHeader />
          </Suspense>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
