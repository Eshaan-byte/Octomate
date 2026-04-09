"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * LoaderBlock — A long-wait-friendly loading indicator used in place of bare
 * skeletons. Actions against the Nosana-hosted Qwen endpoint can take 5–75s,
 * so we show:
 *   - a spinning icon + action-specific label
 *   - an elapsed-time counter so the user knows work is still happening
 *   - a small set of skeleton bars as a visual placeholder
 */
export function LoaderBlock({
  label = "Working…",
  hint,
  lines = 3,
  className,
}: {
  label?: string;
  hint?: string;
  lines?: number;
  className?: string;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 250);
    return () => clearInterval(id);
  }, []);

  const widths = ["w-3/4", "w-full", "w-5/6", "w-2/3", "w-4/5"];

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium">
              {label}
              <AnimatedDots />
            </span>
            <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
              {elapsed}s
            </span>
          </div>
          {hint && (
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {hint}
            </div>
          )}
        </div>
      </div>
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            className={cn("h-4", widths[i % widths.length])}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * AnimatedDots — three dots that cycle ".", "..", "..." to hint that work
 * is still in progress. Pure CSS would be cleaner, but a tiny setInterval
 * keeps it predictable across browsers.
 */
function AnimatedDots() {
  const [n, setN] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setN((x) => (x % 3) + 1), 450);
    return () => clearInterval(id);
  }, []);
  return <span className="inline-block w-4 text-left">{".".repeat(n)}</span>;
}
