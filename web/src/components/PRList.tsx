"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { PRReviewCard } from "./PRReviewCard";
import { github } from "@/lib/agent-client";

interface PR {
  number: number;
  title: string;
  user: { login: string } | null;
  html_url: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
}

export function PRList({ owner, repo }: { owner: string; repo: string }) {
  const [prs, setPRs] = useState<PR[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPRs(null);
    setError(null);
    github<PR[]>(`/repos/${owner}/${repo}/pulls?state=open&per_page=10`)
      .then(setPRs)
      .catch((e) => setError((e as Error).message));
  }, [owner, repo]);

  if (error) {
    return (
      <div className="rounded-md border border-border p-4 text-sm text-rose-400">
        Failed to load PRs: {error}
      </div>
    );
  }

  if (!prs) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  if (prs.length === 0) {
    return (
      <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">
        No open pull requests.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {prs.map((pr) => (
        <PRReviewCard key={pr.number} pr={pr} repo={`${owner}/${repo}`} />
      ))}
    </div>
  );
}
