import fs from 'fs';
import { Skeleton, GenerationUnit } from '../src/lib/types/skeleton';

interface ValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

function validateBackboneIntegrity(skeleton: Skeleton): ValidationResult {
  const result: ValidationResult = { passed: true, errors: [], warnings: [] };
  // In a real run, we would load the original N4 JSON and compare IDs.
  // For now, we check that every unit has at least one mapped N4 ID.
  
  for (const section of skeleton.sections) {
    for (const sub of section.subsections) {
      for (const unit of sub.units) {
        // Skip traceability check for injected boxes
        if (unit.type.startsWith('box_')) continue;

        if (!unit.n4_mapping || unit.n4_mapping.length === 0) {
          result.errors.push(`Unit ${unit.id} in ${sub.id} has no N4 mapping traceability.`);
        }
      }
    }
  }
  
  if (result.errors.length > 0) result.passed = false;
  return result;
}

function validateFlowSafety(skeleton: Skeleton): ValidationResult {
  const result: ValidationResult = { passed: true, errors: [], warnings: [] };
  
  for (const section of skeleton.sections) {
    for (const sub of section.subsections) {
      for (let i = 0; i < sub.units.length - 1; i++) {
        const current = sub.units[i];
        const next = sub.units[i+1];
        
        // Check 1: Prose ending in ':' followed by a Box
        // This suggests a split list or a bad insertion point
        const lastFact = current.content.facts[current.content.facts.length - 1] || '';
        if (current.type === 'prose' && lastFact.trim().endsWith(':')) {
           if (next.type.startsWith('box_')) {
             result.errors.push(`FLOW ERROR: Unit ${current.id} (Prose ending in ':') is immediately followed by a Box (${next.type}). This breaks reading flow.`);
           }
        }
        
        // Check 2: Box inside a logical list?
        // Since we merge lists into 'composite_list', a box can't be "inside" unless we failed to merge.
        // If we failed to merge, we'd see Prose(:) -> Box -> List.
        if (current.type === 'prose' && lastFact.trim().endsWith(':')) {
             const nextNext = sub.units[i+2];
             if (nextNext && nextNext.type === 'composite_list') { // or 'list' if we had that type
                 result.errors.push(`FLOW ERROR: Split List detected. Prose(:) -> ${next.type} -> List. Unit IDs: ${current.id}, ${next.id}, ${nextNext.id}`);
             }
        }
      }
    }
  }
  
  if (result.errors.length > 0) result.passed = false;
  return result;
}

function validateContentCompleteness(skeleton: Skeleton): ValidationResult {
  const result: ValidationResult = { passed: true, errors: [], warnings: [] };
  
  for (const section of skeleton.sections) {
    for (const sub of section.subsections) {
      for (const unit of sub.units) {
        if (unit.content.facts.length === 0) {
          result.errors.push(`Unit ${unit.id} in ${sub.id} is empty (no facts).`);
        }
      }
    }
  }
  
  if (result.errors.length > 0) result.passed = false;
  return result;
}

function validateKdCompliance(skeleton: Skeleton): ValidationResult {
  const result: ValidationResult = { passed: true, errors: [], warnings: [] };
  const forbidden = ['cliënt', 'verpleegkundige']; // simplistic check
  
  for (const section of skeleton.sections) {
    for (const sub of section.subsections) {
      for (const unit of sub.units) {
        for (const fact of unit.content.facts) {
          const lower = fact.toLowerCase();
          for (const term of forbidden) {
            if (lower.includes(term)) {
              result.warnings.push(`KD WARNING: Unit ${unit.id} contains forbidden term '${term}'.`);
            }
          }
        }
      }
    }
  }
  
  // KD warnings don't necessarily fail the build in this strict skeleton phase (since source might have them),
  // but we should be aware.
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const inputPath = args[0];
  
  if (!inputPath || !fs.existsSync(inputPath)) {
    console.error("Usage: tsx scripts/validate-skeleton.ts <skeleton.json>");
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, 'utf8');
  const skeleton = JSON.parse(raw) as Skeleton;
  
  console.log(`🔍 Validating Skeleton: ${inputPath}`);
  
  const checks = [
    { name: "Backbone Integrity", fn: validateBackboneIntegrity },
    { name: "Flow Safety", fn: validateFlowSafety },
    { name: "Content Completeness", fn: validateContentCompleteness },
    { name: "KD Compliance", fn: validateKdCompliance }
  ];
  
  let allPassed = true;
  
  for (const check of checks) {
    const res = check.fn(skeleton);
    if (!res.passed) {
      console.error(`❌ ${check.name} FAILED:`);
      res.errors.forEach(e => console.error(`   - ${e}`));
      allPassed = false;
    } else {
      console.log(`✅ ${check.name} Passed`);
    }
    if (res.warnings.length > 0) {
       console.warn(`⚠️ ${check.name} Warnings:`);
       res.warnings.forEach(w => console.warn(`   - ${w}`));
    }
  }
  
  if (!allPassed) {
    console.error("\n🛑 Skeleton Validation FAILED. Fix structure before proceeding.");
    process.exit(1);
  }
  
  console.log("\n✨ Skeleton Validation SUCCESS.");
}

main().catch(console.error);

