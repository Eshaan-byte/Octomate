"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Github, Star, GitFork } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ChatPanel } from "@/components/ChatPanel";
import { PRList } from "@/components/PRList";
import { IssueTriageQueue } from "@/components/IssueTriageQueue";
import { DependencyHealthPanel } from "@/components/DependencyHealthPanel";
import { ActivityDigestPanel } from "@/components/ActivityDigestPanel";
import { CIStatusPanel } from "@/components/CIStatusPanel";
import { github } from "@/lib/agent-client";

interface RepoMeta {
  full_name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  default_branch: string;
  html_url: string;
  language: string | null;
  topics?: string[];
}

export default function DashboardPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = use(params);
  const full = `${owner}/${repo}`;
  const [meta, setMeta] = useState<RepoMeta | null>(null);

  useEffect(() => {
    localStorage.setItem("octomate:repo", full);
    github<RepoMeta>(`/repos/${owner}/${repo}`)
      .then(setMeta)
      .catch(() => setMeta(null));
  }, [owner, repo, full]);

  return (
    <main className="container mx-auto max-w-7xl px-4 py-6">
      {/* --- Header --- */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Link
            href="/"
            className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> back
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Github className="h-5 w-5" />
            {full}
            {meta && (
              <a
                href={meta.html_url}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </h1>
          {meta ? (
            <>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                {meta.description ?? "—"}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Star className="h-3 w-3" /> {meta.stargazers_count.toLocaleString()}
                </span>
                <span className="flex items-center gap-1">
                  <GitFork className="h-3 w-3" /> {meta.forks_count.toLocaleString()}
                </span>
                {meta.language && <Badge variant="outline">{meta.language}</Badge>}
                <Badge variant="outline">{meta.default_branch}</Badge>
              </div>
            </>
          ) : (
            <Skeleton className="mt-2 h-4 w-96" />
          )}
        </div>
      </div>

      {/* --- Main grid: left/main content + right chat --- */}
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="prs">Pull Requests</TabsTrigger>
              <TabsTrigger value="issues">Issues</TabsTrigger>
              <TabsTrigger value="deps">Dependencies</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <ActivityDigestPanel repo={full} />
                <CIStatusPanel repo={full} />
              </div>
              <Card>
                <CardContent className="p-4 text-sm text-muted-foreground">
                  <p>
                    Click <strong>Generate</strong> on any panel to run the
                    matching ElizaOS action. Results stream back from the agent
                    running on Nosana (or your local dev server).
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="prs">
              <PRList owner={owner} repo={repo} />
            </TabsContent>

            <TabsContent value="issues">
              <IssueTriageQueue repo={full} />
            </TabsContent>

            <TabsContent value="deps">
              <DependencyHealthPanel repo={full} />
            </TabsContent>
          </Tabs>
        </div>

        <div className="lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
          <ChatPanel repo={full} />
        </div>
      </div>
    </main>
  );
}
