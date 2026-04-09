# OctoMate

**A senior engineer in a box.** OctoMate is an [ElizaOS v2](https://github.com/elizaOS/eliza) agent that reviews pull requests, triages issues, audits dependencies, and reports CI health for any GitHub repo — with a polished Next.js dashboard and a chat panel on the side. It runs as a single Docker container on the [Nosana](https://nosana.io) decentralized GPU network and talks to the hosted **Qwen 3.5-9B-FP8** endpoint provided by the challenge.

Built for the **Nosana x ElizaOS Builders Challenge** — April 2026.

---

## What it does

Point OctoMate at a repo (`owner/repo`) and it gives you:

| Action | What it does |
|---|---|
| `REVIEW_PR` | Fetches a PR's diff, runs a senior-engineer review: risk level, file notes, suggestions, verdict. |
| `TRIAGE_ISSUES` | Classifies the 10 most recent open issues by severity (P0–P3), area, suggested labels, and suggested assignee (inferred from recent committers). |
| `SUMMARIZE_ACTIVITY` | Weekly digest: commits, merged PRs, closed issues, contributors, themes, things worth watching. |
| `CHECK_DEPENDENCIES` | Detects the repo's manifest (npm, PyPI, crates.io, Go modules, RubyGems, Packagist, or CRAN), queries the right registry for latest + deprecations, returns a health score and an upgrade order. |
| `CI_STATUS` | Per-workflow status, fail streaks, flaky-test detection from the last 10 runs. |

Every action is a real ElizaOS v2 `Action` object, backed by Octokit calls and structured-output prompts to Qwen 3.5. The frontend renders each result as a rich card — not just a wall of JSON.

The chat panel on the right of the dashboard shares the repo context: a `repoContext` provider injects live repo state (name, default branch, open PR/issue counts, latest commit) into every LLM turn, so you can just ask *"what changed yesterday?"* and get a grounded answer. Replies render as real markdown with auto-linkified `#PR`/`owner/repo@sha` refs, and a row of one-tap quick-action chips above the input lets you trigger any of the 5 actions without typing.

---

## Architecture

```
                   ┌─────────────────────────────────────────────┐
                   │  Nosana GPU node (single container)         │
                   │                                             │
  Browser ──HTTPS──┼──► Next.js :3000 ──rewrites──► Agent :4111  │
                   │       (UI + cards)             (ElizaOS)    │
                   │                                    │        │
                   └────────────────────────────────────┼────────┘
                                                        │
                            ┌───────────────────────────┼──────────────┐
                            ▼                           ▼              ▼
                     GitHub REST API           Qwen 3.5-9B-FP8    package registries
                     (via Octokit)             (Nosana-hosted)    (npm/PyPI/crates/…)
```

**Why one container with two processes?** Cleaner deploy, single public URL, and the agent is never exposed to the open internet — only Next.js is. `scripts/start.sh` traps signals so if either process dies, the whole container restarts.

---

## Repository layout

```
.
├── agent/                      # ElizaOS v2 agent (TypeScript)
│   ├── characters/
│   │   └── octomate.character.json
│   └── src/
│       ├── index.ts            # bootstrap + express server
│       ├── runtime.ts          # plugin runner + tool routing
│       ├── server.ts           # REST API
│       ├── types.ts            # ElizaOS-compatible Action/Provider/Plugin
│       └── plugin-github/
│           ├── index.ts
│           ├── client.ts
│           ├── actions/
│           │   ├── reviewPR.ts
│           │   ├── triageIssue.ts
│           │   ├── summarizeActivity.ts
│           │   ├── checkDependencies.ts
│           │   └── ciStatus.ts
│           └── providers/
│               └── repoContext.ts
├── web/                        # Next.js 15 + Tailwind + shadcn-style UI
│   └── src/
│       ├── app/
│       │   ├── page.tsx                       # landing
│       │   └── dashboard/[owner]/[repo]/page.tsx
│       ├── components/
│       │   ├── ChatPanel.tsx
│       │   ├── PRReviewCard.tsx
│       │   ├── IssueTriageQueue.tsx
│       │   ├── DependencyHealthPanel.tsx
│       │   ├── ActivityDigestPanel.tsx
│       │   ├── CIStatusPanel.tsx
│       │   └── ui/  (button, card, input, badge, tabs, skeleton)
│       └── lib/
│           ├── agent-client.ts
│           ├── types.ts
│           └── utils.ts
├── Dockerfile                  # multi-stage build
├── docker-compose.yml          # local one-shot
├── nos_job_def.json            # Nosana deployment manifest
├── scripts/
│   ├── start.sh                # container entrypoint
│   └── deploy.sh               # build + push + patch job def
└── README.md
```

---

## Run it locally

**Requirements:** Node.js 23+, pnpm 9+, Docker (optional).

```bash
# 1. Install deps
pnpm install

# 2. Configure env
cp .env.example .env
# edit .env — set OPENAI_API_KEY (or Nosana Qwen endpoint), and optionally GITHUB_TOKEN

# 3. Run agent + web together
pnpm dev
# agent → http://localhost:4111
# web   → http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000), paste `vercel/next.js` (or any repo), optionally add a GitHub PAT for higher rate limits, and click **Launch**.

### Or run it as one Docker container

```bash
# Option A — pull the pre-built image
docker run -p 3000:3000 --env-file .env eshaan677/octomate:latest
# → http://localhost:3000

# Option B — build it yourself
pnpm docker:build
pnpm docker:run
```

---

## Deploy to Nosana

The pre-built image `docker.io/eshaan677/octomate:latest` is already referenced in [nos_job_def.json](./nos_job_def.json), and the Qwen endpoint is baked in — no secrets to set.

1. **Get free builder credits** at [nosana.com/builders-credits](https://nosana.com/builders-credits).
2. **(Optional) Build your own image** instead of using the published one:
   ```bash
   DOCKER_USER=<your-dockerhub-username> ./scripts/deploy.sh
   ```
   This builds, pushes, and patches `nos_job_def.json` with your image reference.
3. **Deploy** via [deploy.nosana.com](https://deploy.nosana.com):
   - Sign in (email or Google/GitHub) and connect your Solana wallet.
   - Create a new deployment, paste `nos_job_def.json`.
   - OctoMate is CPU-only (`"gpu": false`, 2 vCPU / 4 GiB) — the LLM runs on the Nosana-hosted Qwen endpoint, so you don't need a GPU market. Any CPU market works.
4. **Copy the public URL** — it looks like `https://<job-id>.node.k8s.prd.nos.ci:3000`.

---

## Environment variables

| Var | Purpose | Default |
|---|---|---|
| `OPENAI_API_BASE_URL` | OpenAI-compatible endpoint (point at Nosana Qwen for the challenge) | `https://api.openai.com/v1` |
| `OPENAI_API_KEY` | API key for the endpoint above | — |
| `OPENAI_MODEL` | Model name | `gpt-4o-mini` |
| `PORT` | Public web port | `3000` |
| `AGENT_PORT` | Internal agent port | `4111` |
| `GITHUB_TOKEN` | Optional server-side PAT fallback | unset |

Users can also supply a GitHub PAT from the frontend — it's stored in `localStorage`, sent as a header with each request, and **never persisted server-side**.

---

## ElizaOS compatibility

The action objects in `agent/src/plugin-github/actions/` match the ElizaOS v2 `Action` interface: `name`, `similes`, `description`, `examples`, `validate`, `handler`. The runtime in `agent/src/runtime.ts` is a pragmatic subset that executes those same action objects — the shape is drop-in compatible with the full ElizaOS v2 runtime, so the plugin can be registered with an ElizaOS agent without changes. We ship our own thin Express server in `agent/src/server.ts` for frontend communication because it's lighter than running the full ElizaOS server stack for this use case.

---

## Known limitations

- **Ephemeral memory.** Conversation history lives in-process and isn't persisted across container restarts. Fine for a demo; plug in a real store for production.
- **JS/Python/Rust/Go/Ruby/PHP/R dep audit.** `CHECK_DEPENDENCIES` auto-detects manifests for npm, PyPI, crates.io, Go modules, RubyGems, Packagist, and CRAN — but no Java/Maven, Nix, or system-package support yet.
- **Rate limits.** Without a GitHub PAT, the frontend's dashboard metadata calls are limited to 60/hour per IP. Supply a classic read-only PAT to bump to 5000/hour.

---

## Prize submission checklist

- [x] ElizaOS v2 agent with 5 custom actions + 1 provider
- [x] Custom Next.js + Tailwind + shadcn frontend
- [x] Dockerized (`Dockerfile` + `docker-compose.yml`)
- [x] Nosana job definition (`nos_job_def.json`)
- [x] Public GitHub fork (see repo URL)
- [ ] Nosana deployment URL  ← fill after deploy
- [ ] Demo video ≤ 1 minute
- [ ] Social post with #NosanaAgentChallenge @nosana_ai
- [ ] 300-word description
- [ ] All 4 required repos starred

---

Built by an engineer who's tired of reading bad PRs. Powered by ElizaOS, Qwen 3.5, and the Nosana GPU network.
