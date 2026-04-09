import dotenv from "dotenv";
import OpenAI from "openai";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { Runtime } from "./runtime.js";
import { createServer } from "./server.js";
import { githubPlugin } from "./plugin-github/index.js";

const here = dirname(fileURLToPath(import.meta.url));

// Load .env from the workspace root (two levels up from agent/dist),
// then agent-local .env, then cwd — first match wins per-key.
for (const candidate of [
  resolve(here, "../../.env"),     // workspace root when running from dist/
  resolve(here, "../.env"),        // workspace root when running from src/ via tsx
  resolve(process.cwd(), ".env"),  // cwd fallback
]) {
  if (existsSync(candidate)) dotenv.config({ path: candidate });
}

const characterPath = resolve(here, "../characters/octomate.character.json");

const character = JSON.parse(readFileSync(characterPath, "utf-8"));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "sk-dummy",
  baseURL: process.env.OPENAI_API_BASE_URL || "https://api.openai.com/v1",
});

const runtime = new Runtime({
  plugins: [githubPlugin],
  character: {
    name: character.name,
    system: character.system,
    bio: character.bio,
    style: character.style,
  },
  openai,
  model: process.env.OPENAI_MODEL || "gpt-4o-mini",
});

const app = createServer(runtime, character.name);
const port = Number(process.env.AGENT_PORT || 4111);

app.listen(port, () => {
  const baseUrl = process.env.OPENAI_API_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  console.log(`[OctoMate] ready on :${port}`);
  console.log(`[OctoMate] model=${model} endpoint=${baseUrl}`);
  console.log(`[OctoMate] plugins=${githubPlugin.name} actions=${githubPlugin.actions?.length ?? 0}`);
});
