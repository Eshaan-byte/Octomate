"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { GitPullRequest, Bug, Package, Activity, Bot, Cpu } from "lucide-react";

const EXAMPLE_REPOS = [
  "vercel/next.js",
  "facebook/react",
  "elizaOS/eliza",
  "nosana-ci/agent-challenge",
];

export default function Home() {
  const router = useRouter();
  const [repo, setRepo] = useState("");
  const [token, setToken] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem("octomate:recent_repos");
    if (saved) setRecent(JSON.parse(saved));
    const savedToken = localStorage.getItem("octomate:github_token");
    if (savedToken) setToken(savedToken);
  }, []);

  function go(target: string) {
    const m = target.trim().match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/);
    if (!m) return;
    localStorage.setItem("octomate:repo", target);
    if (token) localStorage.setItem("octomate:github_token", token);
    const next = Array.from(new Set([target, ...recent])).slice(0, 5);
    localStorage.setItem("octomate:recent_repos", JSON.stringify(next));
    router.push(`/dashboard/${m[1]}/${m[2]}`);
  }

  return (
    <main className="container mx-auto max-w-4xl px-4 py-16">
      <div className="mb-12 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs text-muted-foreground">
          <Cpu className="h-3 w-3" /> running on Nosana · powered by Qwen 3.5 · built with ElizaOS
        </div>
        <h1 className="mb-4 text-5xl font-bold tracking-tight">
          <span className="text-primary">Octo</span>Mate
        </h1>
        <p className="mx-auto max-w-xl text-lg text-muted-foreground">
          A senior engineer in a box. Point OctoMate at any GitHub repo and it
          reviews PRs, triages issues, audits dependencies, and tells you what
          to worry about next.
        </p>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" /> Connect a repository
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            <Input
              placeholder="owner/repo (e.g. vercel/next.js)"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && go(repo)}
            />
            <Input
              type="password"
              placeholder="GitHub PAT (optional, for private repos & higher rate limits)"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && go(repo)}
            />
            <Button onClick={() => go(repo)}>Launch</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Your PAT stays in your browser — it's sent with each request and
            never stored on the server. Use a classic read-only token.
          </p>

          <div className="pt-2">
            <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              Try an example
            </div>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_REPOS.map((r) => (
                <button
                  key={r}
                  onClick={() => {
                    setRepo(r);
                    go(r);
                  }}
                  className="rounded-md border border-border bg-card px-3 py-1 text-sm hover:bg-accent"
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {recent.length > 0 && (
            <div className="pt-2">
              <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                Recent
              </div>
              <div className="flex flex-wrap gap-2">
                {recent.map((r) => (
                  <button
                    key={r}
                    onClick={() => go(r)}
                    className="rounded-md border border-border bg-card px-3 py-1 text-sm hover:bg-accent"
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <FeatureCard
          icon={<GitPullRequest className="h-5 w-5 text-primary" />}
          title="Review any PR"
          body="Risk level, file-by-file notes, a verdict. Grounded in the real diff, not the title."
        />
        <FeatureCard
          icon={<Bug className="h-5 w-5 text-primary" />}
          title="Triage issues"
          body="Severity P0–P3, area, suggested labels, and an owner guess based on recent committers."
        />
        <FeatureCard
          icon={<Package className="h-5 w-5 text-primary" />}
          title="Audit dependencies"
          body="Scans package.json, checks npm registry for latest + deprecated, hands back an upgrade plan."
        />
        <FeatureCard
          icon={<Activity className="h-5 w-5 text-primary" />}
          title="Weekly digest + CI"
          body="What happened in the last 7 days, which workflows are failing, which are flaky."
        />
      </div>

      <footer className="mt-16 text-center text-xs text-muted-foreground">
        <Badge variant="outline">Nosana Builders Challenge · ElizaOS v2 · April 2026</Badge>
      </footer>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}
