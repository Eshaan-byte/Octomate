"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoaderBlock } from "@/components/LoaderBlock";
import { Sparkles, Bug } from "lucide-react";
import { toast } from "sonner";
import { runAction } from "@/lib/agent-client";
import type { TriagedIssue } from "@/lib/types";

interface TriageData {
  repo: string;
  count: number;
  triaged: TriagedIssue[];
  summary: string;
}

const sevVariant: Record<string, "danger" | "warning" | "secondary" | "outline"> = {
  P0: "danger",
  P1: "danger",
  P2: "warning",
  P3: "secondary",
};

export function IssueTriageQueue({ repo }: { repo: string }) {
  const [data, setData] = useState<TriageData | null>(null);
  const [loading, setLoading] = useState(false);

  async function triage() {
    setLoading(true);
    try {
      const res = await runAction<TriageData>(
        "TRIAGE_ISSUES",
        { limit: 10 },
        { repo, text: "triage open issues" }
      );
      setData(res.data ?? null);
      toast.success(`Triaged ${res.data?.count ?? 0} issues`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bug className="h-4 w-4" /> Issue triage
          </CardTitle>
          <Button onClick={triage} size="sm" variant="outline" disabled={loading}>
            <Sparkles className="mr-2 h-3 w-3" />
            {data ? "Re-triage" : "Triage 10 open"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && (
          <LoaderBlock
            label="Triaging open issues"
            hint="Classifying severity, area, and suggesting labels"
            lines={4}
          />
        )}

        {data && !loading && (
          <>
            <p className="text-sm text-muted-foreground">{data.summary}</p>
            <div className="space-y-2">
              {data.triaged.map((it) => (
                <div
                  key={it.number}
                  className="rounded-md border border-border bg-card/50 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={sevVariant[it.severity] ?? "outline"}>
                          {it.severity}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {it.area}
                        </Badge>
                        {it.suggested_assignee && (
                          <span className="text-xs text-muted-foreground">
                            → @{it.suggested_assignee}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 truncate text-sm font-medium">
                        #{it.number} {it.title}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {it.reasoning}
                      </div>
                      {it.suggested_labels?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {it.suggested_labels.map((l) => (
                            <span
                              key={l}
                              className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                            >
                              {l}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {!data && !loading && (
          <p className="text-sm text-muted-foreground">
            Click triage to classify the 10 most recent open issues.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
