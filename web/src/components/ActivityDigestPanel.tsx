"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoaderBlock } from "@/components/LoaderBlock";
import { Activity, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { runAction } from "@/lib/agent-client";
import type { ActivityDigest } from "@/lib/types";

export function ActivityDigestPanel({ repo }: { repo: string }) {
  const [data, setData] = useState<ActivityDigest | null>(null);
  const [loading, setLoading] = useState(false);

  async function digest() {
    setLoading(true);
    try {
      const res = await runAction<ActivityDigest>(
        "SUMMARIZE_ACTIVITY",
        { days: 7 },
        { repo, text: "summarize last 7 days" }
      );
      setData(res.data ?? null);
      toast.success("Weekly digest ready");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" /> Weekly digest
          </CardTitle>
          <Button onClick={digest} size="sm" variant="outline" disabled={loading}>
            <Sparkles className="mr-2 h-3 w-3" />
            {data ? "Refresh" : "Generate"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && (
          <LoaderBlock
            label="Summarizing the last 7 days"
            hint="Scanning commits, merged PRs, closed issues, new contributors"
            lines={4}
          />
        )}

        {data && !loading && (
          <>
            <h3 className="text-base font-semibold">{data.digest?.headline}</h3>

            <div className="grid grid-cols-4 gap-2 rounded-md border border-border p-2 text-center">
              <Stat label="commits" value={data.stats.commits} />
              <Stat label="merged PRs" value={data.stats.merged_prs} />
              <Stat label="closed issues" value={data.stats.closed_issues} />
              <Stat label="contributors" value={data.stats.contributors} />
            </div>

            {data.digest?.themes && data.digest.themes.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {data.digest.themes.map((t) => (
                  <Badge key={t} variant="outline" className="text-[10px]">
                    {t}
                  </Badge>
                ))}
              </div>
            )}

            {data.digest?.highlights && data.digest.highlights.length > 0 && (
              <div>
                <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                  Highlights
                </div>
                <ul className="ml-4 list-disc space-y-0.5 text-sm">
                  {data.digest.highlights.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              </div>
            )}

            {data.digest?.watch_items && data.digest.watch_items.length > 0 && (
              <div>
                <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                  Worth watching
                </div>
                <ul className="ml-4 list-disc space-y-0.5 text-sm text-muted-foreground">
                  {data.digest.watch_items.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {!data && !loading && (
          <p className="text-sm text-muted-foreground">
            Generate a summary of the last 7 days in this repo.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
    </div>
  );
}
