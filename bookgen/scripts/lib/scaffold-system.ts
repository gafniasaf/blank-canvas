/**
 * Scaffold System — reads system-manifest.json and generates:
 * 1. src/lib/contracts.ts (Zod schemas + JOB_MODES + PIPELINE_STEPS)
 * 2. Strategy stubs (gen-*.ts) for any job missing a hand-written implementation
 * 3. src/strategies/registry.ts (auto-generated import map)
 *
 * Ported from LearnPlay's scripts/lib/scaffold-system.ts, adapted for BookGen.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const MANIFEST_PATH = path.join(ROOT, "system-manifest.json");
const CONTRACTS_PATH = path.join(ROOT, "src/lib/contracts.ts");
const STRATEGIES_DIR = path.join(ROOT, "src/strategies");
const REGISTRY_PATH = path.join(ROOT, "src/strategies/registry.ts");

// ─── Types ───────────────────────────────────────────────────────────

interface FieldDef {
  name: string;
  type: "string" | "number" | "boolean" | "date" | "json" | "enum";
  options?: string[];
}

interface EntityDef {
  name: string;
  slug: string;
  fields: FieldDef[];
}

interface AgentJobDef {
  id: string;
  target_entity?: string;
  execution_mode: "async" | "synchronous";
  ui?: { label: string; icon: string; placement: string };
  prompt_template?: string;
}

interface Manifest {
  branding?: { name: string; tagline: string };
  data_model: {
    root_entities: EntityDef[];
    child_entities: EntityDef[];
  };
  agent_jobs: AgentJobDef[];
  edge_functions?: Array<{ id: string; input?: Record<string, unknown>; output?: Record<string, unknown> }>;
}

// ─── Zod mapping ─────────────────────────────────────────────────────

function mapTypeToZod(field: FieldDef): string {
  let zodType = "z.any()";
  switch (field.type) {
    case "string": zodType = "z.string()"; break;
    case "number": zodType = "z.number()"; break;
    case "boolean": zodType = "z.boolean()"; break;
    case "date": zodType = "z.string().datetime()"; break;
    case "json": zodType = "z.any()"; break;
    case "enum":
      if (field.options?.length) {
        zodType = `z.enum([${field.options.map((o) => `'${o}'`).join(", ")}])`;
      } else {
        zodType = "z.string()";
      }
      break;
  }
  return zodType;
}

// ─── Contract generation ─────────────────────────────────────────────

function generateEntitySchema(entity: EntityDef): string {
  const fields = entity.fields.map((f) => `  ${f.name}: ${mapTypeToZod(f)}.optional()`).join(",\n");

  return `
export const ${entity.name}Schema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
${fields}
});
export type ${entity.name} = z.infer<typeof ${entity.name}Schema>;
`;
}

function generateJobModes(jobs: AgentJobDef[]): string {
  const entries = jobs.map((j) => `  "${j.id}": "${j.execution_mode}"`).join(",\n");
  return `
export const JOB_MODES = {
${entries}
} as const;

export type JobType = keyof typeof JOB_MODES;
`;
}

function generatePipelineSteps(jobs: AgentJobDef[]): string {
  const steps = jobs.map((j) => `  "${j.id}"`).join(",\n");
  return `
export const PIPELINE_STEPS = [
${steps}
] as const;

export type PipelineStep = typeof PIPELINE_STEPS[number];
`;
}

function generateContracts(manifest: Manifest): string {
  const allEntities = [
    ...manifest.data_model.root_entities,
    ...manifest.data_model.child_entities,
  ];

  const header = `
// ------------------------------------------------------------------
// AUTO-GENERATED FROM system-manifest.json
// ------------------------------------------------------------------
// Run: npx ignite scaffold
// DO NOT EDIT MANUALLY — changes will be overwritten.
// ------------------------------------------------------------------
import { z } from 'zod';
`;

  const schemas = allEntities.map(generateEntitySchema).join("\n");
  const jobModes = generateJobModes(manifest.agent_jobs);
  const pipelineSteps = generatePipelineSteps(manifest.agent_jobs);

  return header + schemas + jobModes + pipelineSteps;
}

// ─── Strategy stub generation ────────────────────────────────────────

function toPascalCase(str: string): string {
  return str.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
}

function generateStrategyStub(job: AgentJobDef, brandName: string): string {
  const className = `Generated${toPascalCase(job.id)}`;
  return `
// AUTO-GENERATED stub by scaffold-system.ts
// Replace with a hand-written implementation in src/strategies/${job.id}.ts
import type { JobContext, JobExecutor, StrategyResult } from "./types.js";

export class ${className} implements JobExecutor {
  async execute(ctx: JobContext): Promise<StrategyResult> {
    const { job } = ctx;
    console.log(\`[${job.id}] Stub execution for job \${job.id}\`);
    // TODO: Implement ${job.id} strategy
    return { ok: true, stub: true, step: "${job.id}" };
  }
}

export default ${className};
`;
}

function generateStrategies(manifest: Manifest): void {
  const brandName = manifest.branding?.name ?? "BookGen";

  for (const job of manifest.agent_jobs) {
    const handWrittenPath = path.join(STRATEGIES_DIR, `${job.id}.ts`);
    const stubPath = path.join(STRATEGIES_DIR, `gen-${job.id}.ts`);

    // Only generate stub if no hand-written implementation exists
    if (fs.existsSync(handWrittenPath)) {
      console.log(`  [skip] ${job.id}.ts exists (hand-written)`);
      continue;
    }

    const content = generateStrategyStub(job, brandName);
    fs.writeFileSync(stubPath, content.trimStart(), "utf-8");
    console.log(`  [gen]  gen-${job.id}.ts (stub)`);
  }
}

// ─── Registry generation ─────────────────────────────────────────────

function generateRegistry(manifest: Manifest): string {
  const imports: string[] = [];
  const entries: string[] = [];

  for (const job of manifest.agent_jobs) {
    const handWrittenPath = path.join(STRATEGIES_DIR, `${job.id}.ts`);
    const hasHandWritten = fs.existsSync(handWrittenPath);

    if (hasHandWritten) {
      // Default export from hand-written file
      const className = toPascalCase(job.id);
      imports.push(`import ${className} from "./${job.id}.js";`);
      entries.push(`  "${job.id}": new ${className}()`);
    } else {
      const className = `Generated${toPascalCase(job.id)}`;
      imports.push(`import { ${className} } from "./gen-${job.id}.js";`);
      entries.push(`  "${job.id}": new ${className}()`);
    }
  }

  return `// AUTO-GENERATED by scaffold-system.ts
// Run: npx ignite scaffold
import type { JobExecutor } from "./types.js";
${imports.join("\n")}

export const JobRegistry: Record<string, JobExecutor> = {
${entries.join(",\n")}
};
`;
}

// ─── Main ────────────────────────────────────────────────────────────

export async function scaffoldManifest(): Promise<void> {
  console.log("📜 Reading system-manifest.json...");
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error("system-manifest.json not found at " + MANIFEST_PATH);
  }

  const manifest: Manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));

  // 1. Generate contracts.ts
  console.log("📝 Generating src/lib/contracts.ts...");
  const contractsDir = path.dirname(CONTRACTS_PATH);
  if (!fs.existsSync(contractsDir)) fs.mkdirSync(contractsDir, { recursive: true });
  const contracts = generateContracts(manifest);
  fs.writeFileSync(CONTRACTS_PATH, contracts.trimStart(), "utf-8");
  console.log(`  ✅ Written: ${path.relative(ROOT, CONTRACTS_PATH)}`);

  // 2. Generate strategy stubs
  console.log("🔧 Generating strategy stubs...");
  generateStrategies(manifest);

  // 3. Generate registry
  console.log("📋 Generating strategies/registry.ts...");
  const registry = generateRegistry(manifest);
  fs.writeFileSync(REGISTRY_PATH, registry, "utf-8");
  console.log(`  ✅ Written: ${path.relative(ROOT, REGISTRY_PATH)}`);

  console.log("\n✅ Scaffold complete.");
}

