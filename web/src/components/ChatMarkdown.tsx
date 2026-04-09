"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * Auto-linkify GitHub-shaped entities so plain agent output like
 *   "PR #7384 by @octocat, commit f2ac58e, see refinedev/refine"
 * becomes clickable without the LLM having to emit real URLs.
 *
 * Skips anything already inside a markdown link/autolink or fenced code
 * block — we don't want to double-wrap `[#7](url)` or rewrite code samples.
 */
function autoLinkify(text: string, repo?: string): string {
  // Split on code fences + inline code + existing markdown links and only
  // transform the "plain" segments. We use a non-capturing alternation so
  // the split result interleaves [plain, skipped, plain, skipped, ...].
  const SKIP_RE = /(```[\s\S]*?```|`[^`\n]*`|\[[^\]]*\]\([^)]*\)|<https?:[^>]+>)/g;
  const parts = text.split(SKIP_RE);

  return parts
    .map((segment, i) => {
      // Odd indexes are the skipped (already-linked / code) segments.
      if (i % 2 === 1) return segment;
      return linkifySegment(segment, repo);
    })
    .join("");
}

function linkifySegment(s: string, repo?: string): string {
  // owner/repo  ->  https://github.com/owner/repo
  // Done first so the later #N rule can anchor on the current repo.
  s = s.replace(
    /(^|[\s(])([A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*)(?=[\s).,!?:;]|$)/g,
    (m, pre, slug) => {
      // Skip things that look like paths or versions, not repos.
      if (/\.(ts|tsx|js|jsx|py|rs|go|rb|md|json|yaml|yml|toml)$/i.test(slug)) {
        return m;
      }
      if (/^\d+\.\d+/.test(slug)) return m; // "1.2/3.4" style
      return `${pre}[${slug}](https://github.com/${slug})`;
    }
  );

  // #1234  ->  link to PR/issue in the current repo (GitHub resolves
  // /issues/N to the PR if N is a PR, so this works for both).
  if (repo && /^[\w.-]+\/[\w.-]+$/.test(repo)) {
    s = s.replace(
      /(^|[\s(])#(\d+)\b/g,
      (_m, pre, num) => `${pre}[#${num}](https://github.com/${repo}/issues/${num})`
    );
  }

  // @username  ->  profile link (avoid email addresses).
  s = s.replace(
    /(^|[\s(])@([A-Za-z0-9][A-Za-z0-9-]{0,38})(?=[\s).,!?:;]|$)/g,
    (_m, pre, user) => `${pre}[@${user}](https://github.com/${user})`
  );

  // 7-to-40 char hex commit SHAs (only when a repo context exists).
  if (repo && /^[\w.-]+\/[\w.-]+$/.test(repo)) {
    s = s.replace(
      /(^|[\s(])([0-9a-f]{7,40})(?=[\s).,!?:;]|$)/g,
      (m, pre, sha) => {
        // Guard against very-long-hex things that aren't commits.
        if (sha.length > 40) return m;
        return `${pre}[\`${sha.slice(0, 7)}\`](https://github.com/${repo}/commit/${sha})`;
      }
    );
  }

  return s;
}

/**
 * Renders assistant replies as GitHub-flavored markdown:
 *   - **bold**, _italic_, `inline code`, fenced blocks
 *   - ### headings, bullet + numbered lists, blockquotes
 *   - tables, strikethrough, task lists, autolinks
 *   - auto-linkified #123 / owner/repo / @user / commit SHAs
 *
 * Styled to feel native inside a chat bubble — no prose plugin required.
 * External links open in a new tab; the "OctoMate" system prompt is still
 * responsible for keeping output on-topic.
 */
export function ChatMarkdown({
  children,
  className,
  repo,
}: {
  children: string;
  className?: string;
  /** Current repo for contextualized #N / SHA links. */
  repo?: string;
}) {
  const source = autoLinkify(children, repo);
  return (
    <div
      className={cn(
        "space-y-2 text-sm leading-relaxed break-words",
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Paragraphs: tight spacing, preserve whitespace.
          p: ({ children }) => <p className="my-1">{children}</p>,

          // Headings: scaled down to fit inside a chat bubble.
          h1: ({ children }) => (
            <h1 className="mb-1 mt-2 text-base font-semibold">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-1 mt-2 text-sm font-semibold">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1 mt-2 text-sm font-semibold text-foreground/90">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="mb-1 mt-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {children}
            </h4>
          ),

          // Lists: slight indent, tight line height, matched marker color.
          ul: ({ children }) => (
            <ul className="my-1 ml-4 list-disc space-y-0.5 marker:text-muted-foreground">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-1 ml-4 list-decimal space-y-0.5 marker:text-muted-foreground">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="my-0">{children}</li>,

          // Inline + fenced code.
          code: ({ className, children, ...props }) => {
            const isBlock = /language-/.test(className || "");
            if (isBlock) {
              return (
                <code
                  className={cn(
                    "block whitespace-pre overflow-x-auto rounded-md border border-border bg-background/60 p-2 text-[11px] font-mono leading-relaxed",
                    className
                  )}
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded bg-background/60 px-1 py-[1px] font-mono text-[11px]"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto">{children}</pre>
          ),

          // Blockquotes: subtle left border.
          blockquote: ({ children }) => (
            <blockquote className="my-1 border-l-2 border-border pl-3 italic text-muted-foreground">
              {children}
            </blockquote>
          ),

          // Links: underlined, primary color, always open externally.
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:text-primary/80"
            >
              {children}
            </a>
          ),

          // GFM tables.
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-[11px]">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="border-b border-border">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="px-2 py-1 text-left font-medium">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border-t border-border/50 px-2 py-1">{children}</td>
          ),

          // Horizontal rule.
          hr: () => <hr className="my-2 border-border" />,

          // Strong / em — keep native semantics but a hair more contrast.
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
