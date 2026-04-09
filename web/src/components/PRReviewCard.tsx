"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoaderBlock } from "@/components/LoaderBlock";
import { Sparkles, ExternalLink, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { runAction } from "@/lib/agent-client";
import type { PRReview } from "@/lib/types";

interface PRSummary {
  number: number;
  title: string;
  user: { login: string } | null;
  html_url: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
}

export function PRReviewCard({
  pr,
  repo,
}: {
  pr: PRSummary;
  repo: string;
}) {
  const [review, setReview] = useState<PRReview | null>(null);
  const [loading, setLoading] = useState(false);

  async function review_() {
    setLoading(true);
    try {
      const res = await runAction<PRReview>(
        "REVIEW_PR",
        { pr: pr.number },
        { repo, text: `review PR ${pr.number}` }
      );
      setReview(res.data ?? null);
      toast.success(`Reviewed PR #${pr.number}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const riskVariant =
    review?.review?.risk === "high"
      ? "danger"
      : review?.review?.risk === "medium"
      ? "warning"
      : review?.review?.risk === "low"
      ? "success"
      : ("outline" as const);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base">
              <span className="text-muted-foreground">#{pr.number}</span>{" "}
              <span className="break-words">{pr.title}</span>
            </CardTitle>
            <div className="mt-1 text-xs text-muted-foreground">
              by {pr.user?.login ?? "?"}
            </div>
          </div>
          <a
            href={pr.html_url}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!review && !loading && (
          <Button onClick={review_} size="sm" variant="outline">
            <Sparkles className="mr-2 h-3 w-3" />
            Review with OctoMate
          </Button>
        )}
        {loading && (
          <LoaderBlock
            label={`Reviewing PR #${pr.number}`}
            hint="Fetching diff and asking OctoMate for a structured review"
            lines={3}
          />
        )}
        {review && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={riskVariant as never}>
                {review.review?.risk === "high" ? (
                  <AlertTriangle className="mr-1 h-3 w-3" />
                ) : (
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                )}
                {String(review.review?.risk ?? "unknown").toUpperCase()} RISK
              </Badge>
              <Badge variant="outline">{review.review?.verdict ?? "—"}</Badge>
              <span className="text-xs text-muted-foreground">
                +{review.additions ?? 0} / -{review.deletions ?? 0} ·{" "}
                {review.changed_files ?? 0} files
              </span>
            </div>

            <p className="text-sm">{review.review?.summary}</p>

            {review.review?.rationale && (
              <p className="text-xs italic text-muted-foreground">
                {review.review.rationale}
              </p>
            )}

            {review.review?.file_notes && review.review.file_notes.length > 0 && (
              <div>
                <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                  File notes
                </div>
                <ul className="space-y-1 text-xs">
                  {review.review.file_notes.map((fn, i) => (
                    <li key={i} className="flex gap-2">
                      <code className="shrink-0 rounded bg-muted px-1 font-mono">
                        {fn.file}
                      </code>
                      <span className="text-muted-foreground">{fn.note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {review.review?.suggestions && review.review.suggestions.length > 0 && (
              <div>
                <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                  Suggestions
                </div>
                <ul className="ml-4 list-disc space-y-0.5 text-xs">
                  {review.review.suggestions.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
