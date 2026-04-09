"use client";

import { useEffect, useRef, useState } from "react";
import {
  Send,
  Bot,
  User,
  Loader2,
  GitPullRequest,
  ListChecks,
  Calendar,
  Package,
  Cpu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { sendMessage } from "@/lib/agent-client";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Quick-action suggestions shown above the chat input. One tap fills in a
 * natural phrasing that the router knows how to match. Covers all 5 custom
 * actions so users don't have to guess what to ask.
 */
const QUICK_ACTIONS: { label: string; prompt: string; Icon: typeof Send }[] = [
  {
    label: "Review latest PR",
    prompt: "review the latest PR and flag any risks",
    Icon: GitPullRequest,
  },
  {
    label: "Triage issues",
    prompt: "triage the 10 most recent open issues",
    Icon: ListChecks,
  },
  {
    label: "Weekly digest",
    prompt: "summarize what happened in this repo over the last 7 days",
    Icon: Calendar,
  },
  {
    label: "Audit deps",
    prompt: "audit the dependencies and tell me what's outdated or deprecated",
    Icon: Package,
  },
  {
    label: "Check CI",
    prompt: "check CI status — any failing or flaky workflows?",
    Icon: Cpu,
  },
];

function ThinkingIndicator() {
  const [dots, setDots] = useState(1);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const dotId = setInterval(() => setDots((x) => (x % 3) + 1), 450);
    const timeId = setInterval(
      () => setElapsed(Math.floor((Date.now() - start) / 1000)),
      250
    );
    return () => {
      clearInterval(dotId);
      clearInterval(timeId);
    };
  }, []);
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
      <Loader2 className="h-3 w-3 animate-spin text-primary" />
      <span className="flex-1 text-muted-foreground">
        OctoMate is thinking
        <span className="inline-block w-4 text-left">{".".repeat(dots)}</span>
      </span>
      <span className="font-mono tabular-nums text-muted-foreground">
        {elapsed}s
      </span>
    </div>
  );
}

export function ChatPanel({ repo }: { repo: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "intro",
      role: "agent",
      text: `Connected to **${repo}**. Ask me to review a PR, triage issues, summarize activity, audit dependencies, or check CI.`,
      createdAt: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  async function runPrompt(rawText: string) {
    const text = rawText.trim();
    if (!text || sending) return;
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, userMsg]);
    setSending(true);
    try {
      const res = await sendMessage(text, { repo });
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "agent",
          text: res.reply,
          action: res.action,
          data: res.data,
          createdAt: res.createdAt,
        },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "agent",
          text: `Error: ${(err as Error).message}`,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function submit() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    await runPrompt(text);
  }

  return (
    <Card className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <Bot className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">OctoMate</span>
        <Badge variant="outline" className="ml-auto text-[10px]">
          {repo}
        </Badge>
      </div>

      <div
        ref={scrollerRef}
        className="thin-scroll flex-1 space-y-4 overflow-y-auto p-4"
      >
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "flex gap-2",
              m.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            {m.role === "agent" && (
              <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20">
                <Bot className="h-3 w-3 text-primary" />
              </div>
            )}
            <div
              className={cn(
                "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
              )}
            >
              {m.action && (
                <Badge variant="outline" className="mb-1 text-[10px]">
                  {m.action}
                </Badge>
              )}
              {m.role === "agent" ? (
                <ChatMarkdown repo={repo}>{m.text}</ChatMarkdown>
              ) : (
                <div className="whitespace-pre-wrap break-words">{m.text}</div>
              )}
            </div>
            {m.role === "user" && (
              <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent">
                <User className="h-3 w-3" />
              </div>
            )}
          </div>
        ))}
        {sending && <ThinkingIndicator />}
      </div>

      <div className="border-t border-border p-3">
        <div className="thin-scroll mb-2 flex gap-1.5 overflow-x-auto pb-1">
          {QUICK_ACTIONS.map(({ label, prompt, Icon }) => (
            <button
              key={label}
              type="button"
              onClick={() => runPrompt(prompt)}
              disabled={sending}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors",
                "hover:border-primary/50 hover:bg-primary/10 hover:text-foreground",
                "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-muted/40 disabled:hover:text-muted-foreground"
              )}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Ask about this repo…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            disabled={sending}
          />
          <Button
            size="icon"
            onClick={submit}
            disabled={sending || !input.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
