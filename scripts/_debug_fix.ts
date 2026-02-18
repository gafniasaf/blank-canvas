import * as fs from 'node:fs';
import { applyDeterministicFixesToParagraphs } from '../src/lib/indesign/rewritesForIndesignFixes';

const inPath = 'output/json_first/MBO_AF4_2024_COMMON_CORE/20251226_223937/rewrites_for_indesign.MBO_AF4_2024_COMMON_CORE.FINAL.json';
const data = JSON.parse(fs.readFileSync(inPath, 'utf8')) as { paragraphs: any[] };
const paras = data.paragraphs;

const targetId = '1beee900-ee4c-4b27-9ef1-a3de6fd25204';
const p0 = paras.find((p) => p.paragraph_id === targetId);
if (!p0) throw new Error('target not found');

console.log('BEFORE rewritten (json):', JSON.stringify(p0.rewritten));

applyDeterministicFixesToParagraphs(paras as any, { mode: 'indesign' });

const p1 = paras.find((p) => p.paragraph_id === targetId);
console.log('AFTER rewritten (fixed):', JSON.stringify(p1.rewritten));
