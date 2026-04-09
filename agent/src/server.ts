import express, { type Request, type Response } from "express";
import cors from "cors";
import { Runtime } from "./runtime.js";
import { makeGitHubClient, parseRepo } from "./plugin-github/client.js";

export function createServer(runtime: Runtime, agentName: string) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  // --- Health check (used by Docker & Nosana healthchecks) ---
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true, agent: agentName, ts: Date.now() });
  });

  // --- Metadata ---
  app.get("/api/agents", (_req: Request, res: Response) => {
    res.json({ agents: [{ id: "octomate", name: agentName }] });
  });

  /**
   * POST /api/agents/:id/messages
   * Body: { text: string, repo?: "owner/repo", github_token?: string }
   * Headers: Authorization: Bearer <github PAT>  (alternative to body field)
   */
  app.post(
    "/api/agents/:id/messages",
    async (req: Request, res: Response) => {
      try {
        const { text, repo, github_token } = req.body ?? {};
        if (typeof text !== "string" || !text.trim()) {
          return res.status(400).json({ error: "text is required" });
        }

        const authHeader = req.get("authorization") || "";
        const headerToken = authHeader.startsWith("Bearer ")
          ? authHeader.slice(7)
          : "";
        const token = github_token || headerToken || undefined;
        const github = makeGitHubClient(token);

        let parsedRepo: { owner: string; repo: string } | undefined;
        if (typeof repo === "string" && repo) {
          parsedRepo = parseRepo(repo) || undefined;
        }

        const { reply, result } = await runtime.invoke(text, {
          github,
          repo: parsedRepo,
        });

        res.json({
          agent: agentName,
          reply,
          action: result?.action ?? null,
          data: result?.data ?? null,
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error("[server] message handler failed:", err);
        res.status(500).json({ error: (err as Error).message });
      }
    }
  );

  // --- List actions (lets the frontend know what's available) ---
  app.get("/api/actions", (_req: Request, res: Response) => {
    res.json({ actions: runtime.listActions() });
  });

  // --- Direct action invocation (the dashboard uses this for card buttons) ---
  app.post("/api/actions/:name", async (req: Request, res: Response) => {
    try {
      const { params, repo, github_token, text } = req.body ?? {};
      const authHeader = req.get("authorization") || "";
      const headerToken = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : "";
      const github = makeGitHubClient(github_token || headerToken || undefined);

      const parsedRepo =
        typeof repo === "string" ? parseRepo(repo) || undefined : undefined;

      const ctx = runtime.makeContext({ github, repo: parsedRepo });
      const actionName = String(req.params.name);
      const result = await runtime.runAction(actionName, ctx, {
        text: text ?? "",
        params: params ?? {},
      });
      res.json(result);
    } catch (err) {
      console.error("[server] action handler failed:", err);
      const status = (err as Error).message.startsWith("unknown action") ? 404 : 500;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  return app;
}
