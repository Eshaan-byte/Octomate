"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoaderBlock } from "@/components/LoaderBlock";
import { Package, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { runAction } from "@/lib/agent-client";
import type { DependencyReport } from "@/lib/types";

const statusVariant: Record<string, "success" | "warning" | "danger" | "outline"> = {
  up_to_date: "success",
  outdated: "warning",
  deprecated: "danger",
  unknown: "outline",
};

export function DependencyHealthPanel({ repo }: { repo: string }) {
  const [data, setData] = useState<DependencyReport | null>(null);
  const [loading, setLoading] = useState(false);

  async function audit() {
    setLoading(true);
    try {
      const res = await runAction<DependencyReport>(
        "CHECK_DEPENDENCIES",
        {},
        { repo, text: "audit dependencies" }
      );
      setData(res.data ?? null);
      toast.success("Dependency audit complete");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const score = data?.report?.health_score ?? null;
  const scoreColor =
    score === null
      ? ""
      : score >= 80
      ? "text-emerald-400"
      : score >= 50
      ? "text-amber-400"
      : "text-rose-400";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4" /> Dependency health
          </CardTitle>
          <Button onClick={audit} size="sm" variant="outline" disabled={loading}>
            <Sparkles className="mr-2 h-3 w-3" />
            {data ? "Re-audit" : "Audit"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && (
          <LoaderBlock
            label="Auditing dependencies"
            hint="Reading package.json, querying npm registry, scoring health"
            lines={5}
          />
        )}

        {data && !loading && (
          <>
            <div className="flex items-center gap-4">
              {score !== null && (
                <div>
                  <div className={`text-3xl font-bold ${scoreColor}`}>
                    {score}
                  </div>
                  <div className="text-[10px] uppercase text-muted-foreground">
                    health
                  </div>
                </div>
              )}
              <div className="flex-1 text-sm">
                <div className="font-medium">{data.report?.headline}</div>
                <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                  <span>{data.stats.total} total</span>
                  <span>{data.stats.outdated} outdated</span>
                  <span>{data.stats.deprecated} deprecated</span>
                </div>
              </div>
            </div>

            {data.report?.notes && (
              <p className="text-xs italic text-muted-foreground">
                {data.report.notes}
              </p>
            )}

            {data.report?.upgrade_order && data.report.upgrade_order.length > 0 && (
              <div>
                <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                  Upgrade order
                </div>
                <ol className="ml-4 list-decimal space-y-0.5 text-xs">
                  {data.report.upgrade_order.slice(0, 8).map((p) => (
                    <li key={p}>
                      <code className="font-mono">{p}</code>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                Packages
              </div>
              <div className="thin-scroll max-h-64 overflow-y-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <tbody>
                    {data.dependencies.map((d) => (
                      <tr
                        key={d.name}
                        className="border-b border-border last:border-none"
                      >
                        <td className="px-2 py-1 font-mono">{d.name}</td>
                        <td className="px-2 py-1 text-muted-foreground">
                          {d.requested}
                        </td>
                        <td className="px-2 py-1 text-muted-foreground">
                          {d.latest ?? "?"}
                        </td>
                        <td className="px-2 py-1 text-right">
                          <Badge
                            variant={statusVariant[d.status] as never}
                            className="text-[9px]"
                          >
                            {d.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {!data && !loading && (
          <p className="text-sm text-muted-foreground">
            Click audit to scan <code>package.json</code> on the default branch.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
