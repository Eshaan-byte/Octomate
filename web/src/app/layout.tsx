import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "OctoMate — ElizaOS GitHub Copilot on Nosana",
  description:
    "A repo-aware ElizaOS agent that reviews PRs, triages issues, audits dependencies and reports CI status — running on the Nosana decentralized GPU network.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">
        {children}
        <Toaster theme="dark" position="top-right" />
      </body>
    </html>
  );
}
