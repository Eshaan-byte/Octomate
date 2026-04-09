"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoaderBlock } from "@/components/LoaderBlock";
import { Cpu, Sparkles, CircleDot, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { runAction } from "@/lib/agent-client";
import type { CIReport } from "@/lib/types";

const verdictVariant: Record<string, "success" | "warning" | "danger" | "outline"> = {
  green: "success",
  yellow: "warning",
  red: "danger",
};

export function CIStatusPanel({ repo }: { repo: string }) {
  const [data, setData] = useState<CIReport | null>(null);
  const [loading, setLoading] = useState(false);

  async function check() {
    setLoading(true);
    try {
      const res = await runAction<CIReport>(
        "CI_STATUS",
        {},
        { repo, text: "check CI" }
      );
      setData(res.data ?? null);
      toast.success("CI report ready");
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
            <Cpu className="h-4 w-4" /> CI status
          </CardTitle>
          <Button onClick={check} size="sm" variant="outline" disabled={loading}>
            <Sparkles className="mr-2 h-3 w-3" />
            {data ? "Refresh" : "Check"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && (
          <LoaderBlock
            label="Checking CI status"
            hint="Pulling recent GitHub Actions runs, scoring flaky workflows"
            lines={3}
          />
        )}

        {data && !loading && (
          <>
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  (verdictVariant[data.verdict?.verdict ?? ""] as never) ?? "outline"
                }
              >
                {(data.verdict?.verdict ?? "unknown").toUpperCase()}
              </Badge>
              <span className="text-sm">{data.verdict?.headline}</span>
            </div>
            {data.verdict?.advice && (
              <p className="text-xs italic text-muted-foreground">
                {data.verdict.advice}
              </p>
            )}
            <div className="space-y-2">
              {data.workflows.map((w) => (
                <div
                  key={w.path}
                  className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    {w.latest === "success" ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    ) : w.latest === "failure" ? (
                      <XCircle className="h-4 w-4 text-rose-400" />
                    ) : (
                      <CircleDot className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div>
                      <div className="font-medium">{w.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {w.path}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {w.flaky && <Badge variant="warning">flaky</Badge>}
                    {w.fail_streak > 1 && (
                      <Badge variant="danger">{w.fail_streak}× fail</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {!data && !loading && (
          <p className="text-sm text-muted-foreground">
            Check the latest GitHub Actions workflow runs.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
