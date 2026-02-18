/**
 * System Map Generator
 *
 * Scans system-manifest.json + src/App.tsx to produce system-map.json.
 * This file is read by AI agents to understand system capabilities before proposing changes.
 *
 * Ported from LearnPlay's scripts/generate-system-map.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

interface RouteEntry {
  path: string;
  componentName: string;
  sourceFile: string;
}

interface CapabilityEntry {
  id: string;
  type: "agent_job" | "edge_function";
  executionMode?: string;
  targetEntity?: string;
}

interface EntityEntry {
  name: string;
  slug: string;
  fieldCount: number;
}

interface SystemMap {
  generatedAt: string;
  routes: RouteEntry[];
  capabilities: CapabilityEntry[];
  entities: EntityEntry[];
}

function extractRoutes(): RouteEntry[] {
  const appPath = path.join(ROOT, "src/App.tsx");
  if (!fs.existsSync(appPath)) return [];

  const content = fs.readFileSync(appPath, "utf-8");
  const routes: RouteEntry[] = [];

  // Match <Route path="..." element={<Component />} />
  const routeRe = /<Route\s+path=["']([^"']+)["']\s+element=\{<(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = routeRe.exec(content))) {
    routes.push({
      path: m[1]!,
      componentName: m[2]!,
      sourceFile: "src/App.tsx",
    });
  }

  return routes;
}

function main() {
  const manifestPath = path.join(ROOT, "system-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error("system-manifest.json not found");
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

  const capabilities: CapabilityEntry[] = [];

  // Agent jobs
  for (const job of manifest.agent_jobs ?? []) {
    capabilities.push({
      id: job.id,
      type: "agent_job",
      executionMode: job.execution_mode,
      targetEntity: job.target_entity,
    });
  }

  // Edge functions
  for (const fn of manifest.edge_functions ?? []) {
    capabilities.push({
      id: fn.id,
      type: "edge_function",
    });
  }

  // Entities
  const allEntities = [
    ...(manifest.data_model?.root_entities ?? []),
    ...(manifest.data_model?.child_entities ?? []),
  ];
  const entities: EntityEntry[] = allEntities.map((e: { name: string; slug: string; fields: unknown[] }) => ({
    name: e.name,
    slug: e.slug,
    fieldCount: Array.isArray(e.fields) ? e.fields.length : 0,
  }));

  const routes = extractRoutes();

  const map: SystemMap = {
    generatedAt: new Date().toISOString(),
    routes,
    capabilities,
    entities,
  };

  const outPath = path.join(ROOT, "system-map.json");
  fs.writeFileSync(outPath, JSON.stringify(map, null, 2), "utf-8");
  console.log(`✅ System map written: ${path.relative(ROOT, outPath)}`);
  console.log(`   Routes: ${routes.length}, Capabilities: ${capabilities.length}, Entities: ${entities.length}`);
}

main();

