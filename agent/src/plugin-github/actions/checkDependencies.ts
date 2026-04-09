import semver from "semver";
import type { Action } from "../../types.js";
import { chatCreate } from "../../llm.js";

/**
 * CHECK_DEPENDENCIES — Auto-detects a project's package manager (Node, Python,
 * Rust, Go, Ruby, PHP), parses its manifest, queries the appropriate registry
 * for the latest version of each dep, then asks the model to write a health
 * report. Works on any public GitHub repo regardless of language.
 */

type Ecosystem = "node" | "python" | "rust" | "go" | "ruby" | "php";

interface RawDep {
  name: string;
  requested: string;
}

interface ResolvedDep extends RawDep {
  latest: string | null;
  deprecated: string | null;
  error?: string;
}

type DepStatus = "up_to_date" | "outdated" | "deprecated" | "unknown";

interface AnnotatedDep extends ResolvedDep {
  status: DepStatus;
}

// -------- Manifest detection ------------------------------------------------

interface Manifest {
  ecosystem: Ecosystem;
  path: string;
  content: string;
}

const MANIFEST_PATHS: { path: string; ecosystem: Ecosystem }[] = [
  { path: "package.json", ecosystem: "node" },
  { path: "pyproject.toml", ecosystem: "python" },
  { path: "requirements.txt", ecosystem: "python" },
  { path: "Cargo.toml", ecosystem: "rust" },
  { path: "go.mod", ecosystem: "go" },
  { path: "Gemfile", ecosystem: "ruby" },
  { path: "composer.json", ecosystem: "php" },
];

async function fetchManifest(
  ctx: Parameters<Action["handler"]>[0],
  repo: { owner: string; repo: string },
  path: string
): Promise<string | null> {
  try {
    const res = await ctx.github.repos.getContent({ ...repo, path });
    if (!("content" in res.data) || Array.isArray(res.data)) return null;
    return Buffer.from(res.data.content, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

// -------- Per-ecosystem parsers --------------------------------------------

function parseNode(content: string): RawDep[] {
  try {
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const merged = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
      ...(pkg.peerDependencies || {}),
    };
    return Object.entries(merged).map(([name, requested]) => ({
      name,
      requested,
    }));
  } catch {
    return [];
  }
}

function parseRequirementsTxt(content: string): RawDep[] {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("-"))
    .map((line) => {
      // Strip inline comments, environment markers, extras.
      const noComment = line.split("#")[0].trim();
      const noMarker = noComment.split(";")[0].trim();
      // e.g. "requests[security]>=2.28.0" or "numpy==1.26.0"
      const m = noMarker.match(/^([A-Za-z0-9_.\-]+)(?:\[[^\]]*\])?\s*([<>=!~].*)?$/);
      if (!m) return null;
      return { name: m[1], requested: (m[2] || "").trim() || "*" };
    })
    .filter((x): x is RawDep => !!x);
}

function parsePyprojectToml(content: string): RawDep[] {
  const deps: RawDep[] = [];
  // PEP 621 style: [project] dependencies = ["foo>=1", "bar"]
  const peP621 = content.match(
    /\[project\][\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/
  );
  if (peP621) {
    for (const m of peP621[1].matchAll(/["']([^"']+)["']/g)) {
      const line = m[1].trim();
      const parsed = line.match(/^([A-Za-z0-9_.\-]+)(?:\[[^\]]*\])?\s*(.*)$/);
      if (parsed) {
        deps.push({ name: parsed[1], requested: parsed[2] || "*" });
      }
    }
  }
  // Poetry style: [tool.poetry.dependencies]
  const poetryBlock = content.match(
    /\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/
  );
  if (poetryBlock) {
    for (const line of poetryBlock[1].split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_.\-]+)\s*=\s*["']?([^"'\n{]*)["']?/);
      if (m && m[1].toLowerCase() !== "python") {
        deps.push({ name: m[1], requested: (m[2] || "*").trim() });
      }
    }
  }
  return deps;
}

function parseCargoToml(content: string): RawDep[] {
  const deps: RawDep[] = [];
  // Handle [dependencies], [dev-dependencies], and [workspace.dependencies].
  const sectionRe = /\[(?:workspace\.)?(?:dev-)?dependencies\]([\s\S]*?)(?:\n\[|$)/g;
  for (const section of content.matchAll(sectionRe)) {
    for (const line of section[1].split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      // name = "1.0" OR name = { version = "1.0", ... }
      const simple = trimmed.match(/^([A-Za-z0-9_.\-]+)\s*=\s*"([^"]+)"/);
      if (simple) {
        deps.push({ name: simple[1], requested: simple[2] });
        continue;
      }
      const tableForm = trimmed.match(
        /^([A-Za-z0-9_.\-]+)\s*=\s*\{[^}]*version\s*=\s*"([^"]+)"/
      );
      if (tableForm) {
        deps.push({ name: tableForm[1], requested: tableForm[2] });
      }
    }
  }
  return deps;
}

/**
 * If a Cargo.toml is a workspace root, extract its `members = [...]` paths
 * so we can probe each member's own Cargo.toml for real dependencies.
 * Skips glob patterns since resolving them requires a tree listing.
 */
function parseCargoWorkspaceMembers(content: string): string[] {
  if (!/^\[workspace\]/m.test(content)) return [];
  const membersBlock = content.match(/members\s*=\s*\[([\s\S]*?)\]/);
  if (!membersBlock) return [];
  const members: string[] = [];
  for (const m of membersBlock[1].matchAll(/["']([^"']+)["']/g)) {
    const path = m[1].trim();
    if (!path.includes("*") && path) members.push(path);
  }
  return members;
}

function parseGoMod(content: string): RawDep[] {
  const deps: RawDep[] = [];
  const lines = content.split(/\r?\n/);
  let inBlock = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    if (line.startsWith("require (")) {
      inBlock = true;
      continue;
    }
    if (inBlock && line === ")") {
      inBlock = false;
      continue;
    }
    if (inBlock) {
      const m = line.match(/^([^\s]+)\s+([^\s]+)/);
      if (m) deps.push({ name: m[1], requested: m[2] });
      continue;
    }
    const single = line.match(/^require\s+([^\s]+)\s+([^\s]+)/);
    if (single) deps.push({ name: single[1], requested: single[2] });
  }
  return deps;
}

function parseGemfile(content: string): RawDep[] {
  const deps: RawDep[] = [];
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(
      /^\s*gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/
    );
    if (m) deps.push({ name: m[1], requested: m[2] || "*" });
  }
  return deps;
}

function parseComposerJson(content: string): RawDep[] {
  try {
    const composer = JSON.parse(content) as {
      require?: Record<string, string>;
      "require-dev"?: Record<string, string>;
    };
    const merged = {
      ...(composer.require || {}),
      ...(composer["require-dev"] || {}),
    };
    return Object.entries(merged)
      .filter(([name]) => !name.startsWith("ext-") && name !== "php")
      .map(([name, requested]) => ({ name, requested }));
  } catch {
    return [];
  }
}

function parseManifest(m: Manifest): RawDep[] {
  switch (m.ecosystem) {
    case "node":
      return parseNode(m.content);
    case "python":
      return m.path === "pyproject.toml"
        ? parsePyprojectToml(m.content)
        : parseRequirementsTxt(m.content);
    case "rust":
      return parseCargoToml(m.content);
    case "go":
      return parseGoMod(m.content);
    case "ruby":
      return parseGemfile(m.content);
    case "php":
      return parseComposerJson(m.content);
  }
}

// -------- Per-ecosystem registry resolvers ---------------------------------

const UA = { "User-Agent": "OctoMate/0.1 (+https://github.com)" };

async function resolveNpm(name: string): Promise<Partial<ResolvedDep>> {
  const r = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
  if (!r.ok) return { error: `npm ${r.status}` };
  const json = (await r.json()) as {
    "dist-tags"?: { latest?: string };
    versions?: Record<string, { deprecated?: string }>;
  };
  const latest = json["dist-tags"]?.latest ?? null;
  const deprecated =
    latest && json.versions?.[latest]?.deprecated
      ? json.versions[latest].deprecated
      : null;
  return { latest, deprecated };
}

async function resolvePyPI(name: string): Promise<Partial<ResolvedDep>> {
  const r = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, {
    headers: UA,
  });
  if (!r.ok) return { error: `pypi ${r.status}` };
  const json = (await r.json()) as {
    info?: { version?: string; yanked?: boolean; yanked_reason?: string };
  };
  return {
    latest: json.info?.version ?? null,
    deprecated: json.info?.yanked ? json.info.yanked_reason || "yanked" : null,
  };
}

async function resolveCratesIo(name: string): Promise<Partial<ResolvedDep>> {
  const r = await fetch(
    `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`,
    { headers: UA }
  );
  if (!r.ok) return { error: `crates ${r.status}` };
  const json = (await r.json()) as {
    crate?: { max_stable_version?: string; max_version?: string };
  };
  return {
    latest: json.crate?.max_stable_version || json.crate?.max_version || null,
    deprecated: null,
  };
}

async function resolveGoProxy(module: string): Promise<Partial<ResolvedDep>> {
  // proxy.golang.org requires the module path to be lower-cased for some
  // camelCased paths; escape upper-case letters per the module proxy spec.
  const escaped = module.replace(/([A-Z])/g, (_, c) => "!" + c.toLowerCase());
  const r = await fetch(`https://proxy.golang.org/${escaped}/@latest`, {
    headers: UA,
  });
  if (!r.ok) return { error: `goproxy ${r.status}` };
  const json = (await r.json()) as { Version?: string };
  return { latest: json.Version ?? null, deprecated: null };
}

async function resolveRubyGems(name: string): Promise<Partial<ResolvedDep>> {
  const r = await fetch(
    `https://rubygems.org/api/v1/gems/${encodeURIComponent(name)}.json`,
    { headers: UA }
  );
  if (!r.ok) return { error: `rubygems ${r.status}` };
  const json = (await r.json()) as { version?: string };
  return { latest: json.version ?? null, deprecated: null };
}

async function resolvePackagist(name: string): Promise<Partial<ResolvedDep>> {
  // Packagist package names are "vendor/name".
  if (!name.includes("/")) return { error: "not a packagist package" };
  const r = await fetch(`https://repo.packagist.org/p2/${name}.json`, {
    headers: UA,
  });
  if (!r.ok) return { error: `packagist ${r.status}` };
  const json = (await r.json()) as {
    packages?: Record<string, { version: string }[]>;
  };
  const versions = json.packages?.[name];
  const stable = versions?.find((v) => !/(dev|alpha|beta|rc)/i.test(v.version));
  return { latest: stable?.version ?? versions?.[0]?.version ?? null, deprecated: null };
}

async function resolveDep(
  ecosystem: Ecosystem,
  dep: RawDep
): Promise<ResolvedDep> {
  try {
    let resolved: Partial<ResolvedDep>;
    switch (ecosystem) {
      case "node":
        resolved = await resolveNpm(dep.name);
        break;
      case "python":
        resolved = await resolvePyPI(dep.name);
        break;
      case "rust":
        resolved = await resolveCratesIo(dep.name);
        break;
      case "go":
        resolved = await resolveGoProxy(dep.name);
        break;
      case "ruby":
        resolved = await resolveRubyGems(dep.name);
        break;
      case "php":
        resolved = await resolvePackagist(dep.name);
        break;
    }
    return {
      name: dep.name,
      requested: dep.requested,
      latest: resolved.latest ?? null,
      deprecated: resolved.deprecated ?? null,
      error: resolved.error,
    };
  } catch (err) {
    return {
      name: dep.name,
      requested: dep.requested,
      latest: null,
      deprecated: null,
      error: (err as Error).message,
    };
  }
}

// -------- Annotation -------------------------------------------------------

function cleanVersion(v: string): string {
  // Strip common version range operators so semver.gte has a chance.
  return v.replace(/^[\^~>=<v]+/, "").split(/\s|,/)[0].trim();
}

function annotate(dep: ResolvedDep): AnnotatedDep {
  if (dep.error) return { ...dep, status: "unknown" };
  if (dep.deprecated) return { ...dep, status: "deprecated" };
  const req = cleanVersion(dep.requested || "");
  const latest = dep.latest ? cleanVersion(dep.latest) : null;
  if (latest && semver.valid(req) && semver.valid(latest)) {
    return { ...dep, status: semver.gte(req, latest) ? "up_to_date" : "outdated" };
  }
  return { ...dep, status: latest ? "outdated" : "unknown" };
}

// -------- Action -----------------------------------------------------------

export const checkDependencies: Action = {
  name: "CHECK_DEPENDENCIES",
  similes: ["DEP_AUDIT", "DEPENDENCY_HEALTH", "AUDIT_DEPS"],
  description:
    "Audit a repository's dependencies across Node, Python, Rust, Go, Ruby, and PHP. Use when the user asks about dependency health, updates, or vulnerabilities.",
  examples: [
    "are my dependencies okay",
    "audit my deps",
    "check dependency health",
  ],

  validate: async (ctx, input) => {
    const t = input.text.toLowerCase();
    return /\b(dep(endenc(y|ies))?|package\.json|pyproject|cargo|go\.mod|gemfile|composer|outdated|audit)\b/.test(
      t
    );
  },

  handler: async (ctx, input) => {
    const repo = (input.params.repo as typeof ctx.repo) || ctx.repo;
    if (!repo) {
      return {
        text: "Which repo should I audit? Set one on the dashboard.",
        action: "CHECK_DEPENDENCIES",
      };
    }

    ctx.log("info", `CHECK_DEPENDENCIES ${repo.owner}/${repo.repo}`);

    // Probe every known manifest path in parallel. We keep every hit so a
    // polyglot repo (e.g. Node frontend + Python backend) still gets a full
    // audit across both ecosystems.
    const found: Manifest[] = (
      await Promise.all(
        MANIFEST_PATHS.map(async ({ path, ecosystem }) => {
          const content = await fetchManifest(ctx, repo, path);
          return content ? { ecosystem, path, content } : null;
        })
      )
    ).filter((m): m is Manifest => m !== null);

    if (found.length === 0) {
      return {
        text: "I couldn't find a supported manifest (package.json, pyproject.toml, requirements.txt, Cargo.toml, go.mod, Gemfile, composer.json) on the default branch.",
        action: "CHECK_DEPENDENCIES",
        data: {
          repo: `${repo.owner}/${repo.repo}`,
          ecosystems: [],
          stats: { total: 0, outdated: 0, deprecated: 0 },
          dependencies: [],
          report: {
            headline: "No supported dependency manifest found",
            health_score: null,
            notes: "This repo doesn't appear to use a supported package manager. Supported: npm, PyPI, crates.io, Go modules, RubyGems, Packagist.",
          },
        },
      };
    }

    // Cargo workspace expansion — if a root Cargo.toml is a pure workspace
    // ([workspace] + members = [...]) it has zero direct deps. Probe the
    // first few member Cargo.toml files so we still get a meaningful audit.
    for (const m of [...found]) {
      if (m.ecosystem !== "rust" || m.path !== "Cargo.toml") continue;
      const members = parseCargoWorkspaceMembers(m.content);
      if (members.length === 0) continue;
      const memberManifests = await Promise.all(
        members.slice(0, 4).map(async (memberPath) => {
          const content = await fetchManifest(ctx, repo, `${memberPath}/Cargo.toml`);
          return content
            ? ({
                ecosystem: "rust" as Ecosystem,
                path: `${memberPath}/Cargo.toml`,
                content,
              } satisfies Manifest)
            : null;
        })
      );
      for (const mm of memberManifests) if (mm) found.push(mm);
    }

    // Parse every found manifest into a single flat list of deps, tagged by
    // ecosystem so the resolver knows which registry to hit.
    interface TaggedDep extends RawDep {
      ecosystem: Ecosystem;
    }
    const tagged: TaggedDep[] = [];
    const seen = new Set<string>();
    for (const m of found) {
      for (const dep of parseManifest(m)) {
        // Dedupe across workspace members so e.g. `serde` isn't audited N times.
        const key = `${m.ecosystem}:${dep.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        tagged.push({ ...dep, ecosystem: m.ecosystem });
      }
    }

    // Cap total work so a huge monorepo doesn't run forever on the shared
    // Nosana endpoint. 50 is plenty for a meaningful signal.
    const capped = tagged.slice(0, 50);

    const resolved = await Promise.all(
      capped.map(async (d) => {
        const r = await resolveDep(d.ecosystem, { name: d.name, requested: d.requested });
        return { ...r, ecosystem: d.ecosystem };
      })
    );

    const annotated = resolved.map((r) => ({ ...annotate(r), ecosystem: r.ecosystem }));

    const outdated = annotated.filter((d) => d.status === "outdated");
    const deprecated = annotated.filter((d) => d.status === "deprecated");

    const compact = annotated
      .map(
        (d) =>
          `- [${d.ecosystem}] ${d.name} @ ${d.requested || "?"} (latest ${d.latest || "?"}) [${d.status}]${
            d.deprecated ? ` — deprecated: ${d.deprecated}` : ""
          }`
      )
      .join("\n");

    const ecosystems = Array.from(new Set(found.map((f) => f.ecosystem)));
    const manifestList = found.map((f) => f.path).join(", ");

    const prompt = `You are auditing dependencies for a ${ecosystems.join("+")} project.

Repository: ${repo.owner}/${repo.repo}
Manifests scanned: ${manifestList}
Total deps checked: ${annotated.length}
Outdated: ${outdated.length}
Deprecated: ${deprecated.length}

Dependency table:
${compact}

Return STRICT JSON (no markdown) with this shape:
{
  "health_score": 0-100,
  "headline": "one-line status",
  "critical": ["package names that must be replaced or upgraded"],
  "recommended": ["package names worth upgrading soon"],
  "upgrade_order": ["ordered list of package names to upgrade first"],
  "notes": "2-3 sentences of senior-engineer commentary"
}`;

    const completion = await chatCreate(ctx.openai, {
      model: ctx.model,
      messages: [
        {
          role: "system",
          content: "You are OctoMate auditing dependencies. JSON only.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let report: Record<string, unknown>;
    try {
      report = JSON.parse(raw);
    } catch {
      report = { headline: raw, health_score: 0 };
    }

    return {
      text: `${report.headline ?? "Dependency audit complete."}`,
      action: "CHECK_DEPENDENCIES",
      data: {
        repo: `${repo.owner}/${repo.repo}`,
        ecosystems,
        manifests: found.map((f) => f.path),
        stats: {
          total: annotated.length,
          outdated: outdated.length,
          deprecated: deprecated.length,
        },
        dependencies: annotated,
        report,
      },
    };
  },
};
