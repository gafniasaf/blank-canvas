import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  PR_MARKER,
  lintRewritesForIndesignJsonParagraphs,
  type RewriteLintMode,
  type RewritesForIndesignParagraph,
} from '../src/lib/indesign/rewritesForIndesignJsonLint';
import { applyDeterministicFixesToParagraphs } from '../src/lib/indesign/rewritesForIndesignFixes';
import { validateCombinedRewriteText } from '../src/lib/indesign/rewritesForIndesign';

function mustContain(haystack: string, needle: string, msg: string) {
  assert.ok(haystack.includes(needle), msg + ` (missing "${needle}")`);
}

function testListIntroMisplacementFix() {
  const paras: RewritesForIndesignParagraph[] = [
    {
      paragraph_id: 'p_intro',
      chapter: '1',
      paragraph_number: 1,
      subparagraph_number: 2,
      style_name: '•Basis',
      original: 'De celmembraan regelt het vervoer van stoffen. Kleine stoffen gaan hier makkelijk doorheen, zoals:',
      rewritten: `Het celmembraan regelt welke stoffen een cel in en uit gaan.\n\n${PR_MARKER} bij een zorgvrager let je op genoeg drinken.`,
    },
    {
      paragraph_id: 'p_b1',
      chapter: '1',
      paragraph_number: 1,
      subparagraph_number: 2,
      style_name: '_Bullets',
      original: 'zuurstof;',
      rewritten: 'zuurstof;',
    },
    {
      paragraph_id: 'p_b2',
      chapter: '1',
      paragraph_number: 1,
      subparagraph_number: 2,
      style_name: '_Bullets',
      original: 'water.',
      rewritten: 'water.',
    },
    {
      paragraph_id: 'p_after',
      chapter: '1',
      paragraph_number: 1,
      subparagraph_number: 2,
      style_name: '•Basis',
      original: 'Grote stoffen moeten op een speciale manier door de celmembraan.',
      rewritten: 'Grote stoffen hebben vaak hulp nodig van eiwitten in het membraan.',
    },
  ];

  const lintBefore = lintRewritesForIndesignJsonParagraphs(paras, { mode: 'prince' });
  assert.ok(lintBefore.errors.length >= 1, 'Expected list-intro+layer-before-bullets to be flagged as an error');

  const introBefore = String(paras[0]!.rewritten || '');
  const afterBefore = String(paras[3]!.rewritten || '');

  applyDeterministicFixesToParagraphs(paras, { mode: 'prince' });

  const introAfter = String(paras[0]!.rewritten || '');
  const afterAfter = String(paras[3]!.rewritten || '');

  assert.ok(introBefore.includes(PR_MARKER), 'Sanity: intro should start with praktijk marker before fix');
  assert.ok(!introAfter.includes(PR_MARKER), 'Fix should remove praktijk marker from list-intro paragraph');

  assert.ok(!afterBefore.includes(PR_MARKER), 'Sanity: target should not have praktijk marker before fix');
  assert.ok(afterAfter.includes(PR_MARKER), 'Fix should move praktijk marker to the first non-bullet paragraph after bullet run');
  assert.ok(String(paras[0]!.rewritten || '').trim().endsWith(':'), 'List-intro paragraph followed by bullets must keep trailing ":" after fix');

  // Validate combined text invariants on the affected paragraphs
  for (const p of [paras[0]!, paras[3]!]) {
    const v = validateCombinedRewriteText(String(p.rewritten || ''));
    assert.deepEqual(v.errors, [], `validateCombinedRewriteText should pass after fix for ${String(p.paragraph_id || '')}`);
  }

  const lintAfter = lintRewritesForIndesignJsonParagraphs(paras, { mode: 'prince' });
  assert.deepEqual(lintAfter.errors, [], 'After fix, JSON-level misplacement lint should pass');
}

function testPunctuationNormalization() {
  const paras: RewritesForIndesignParagraph[] = [
    {
      paragraph_id: 'p_glue',
      chapter: '1',
      paragraph_number: 9,
      subparagraph_number: 9,
      style_name: '•Basis',
      original: 'Dummy.',
      rewritten: 'Dit gaat goed.Want er mist een spatie.',
    },
  ];

  applyDeterministicFixesToParagraphs(paras, { mode: 'prince' });
  assert.equal(String(paras[0]!.rewritten), 'Dit gaat goed. Want er mist een spatie.', 'Should insert missing space after sentence punctuation');
  assert.ok(!String(paras[0]!.rewritten).includes('\r'), 'Fix must never introduce \\r');
}

function testBulletSemicolonStructureContract() {
  const paras: RewritesForIndesignParagraph[] = [
    {
      paragraph_id: 'p_bul',
      chapter: '2',
      paragraph_number: 1,
      subparagraph_number: 6,
      style_name: '_Bullets',
      original: 'water;zout;ureum;bepaalde zuren.',
      rewritten: 'Water, zout, ureum en bepaalde zuren.',
    },
  ];

  const lintIndesign = lintRewritesForIndesignJsonParagraphs(paras, { mode: 'indesign' });
  assert.ok(
    lintIndesign.errors.some((e) => e.includes('bullet semicolon-list structure mismatch')),
    'In indesign mode: bullet semicolon-list structure mismatch must be a hard error'
  );

  const lintPrince = lintRewritesForIndesignJsonParagraphs(paras, { mode: 'prince' });
  assert.ok(
    !lintPrince.errors.some((e) => e.includes('bullet semicolon-list structure mismatch')),
    'In prince mode: bullet semicolon-list structure mismatch must NOT be a hard error'
  );
}

function testDocsLockedDecisionsPresent() {
  const root = path.join(__dirname, '..');
  const noDriftPlan = fs.readFileSync(path.join(root, 'CH1_NO_DRIFT_PLAN.md'), 'utf8');
  mustContain(noDriftPlan, 'Option A', 'CH1_NO_DRIFT_PLAN.md must mention Option A');
  mustContain(noDriftPlan, 'Never', 'CH1_NO_DRIFT_PLAN.md should include explicit hard rules');
  mustContain(noDriftPlan, '\\r', 'CH1_NO_DRIFT_PLAN.md must mention \\r rule');

  const playbook = fs.readFileSync(path.join(root, 'docs', 'INDESIGN_PERFECT_JSON_PLAYBOOK.md'), 'utf8');
  mustContain(playbook, 'Non‑negotiables', 'Playbook must declare non-negotiables');
  mustContain(playbook, 'Option A', 'Playbook must mention Option A');
  mustContain(playbook, 'Guardrails', 'Playbook must include guardrails section');
}

function main() {
  testListIntroMisplacementFix();
  testPunctuationNormalization();
  testBulletSemicolonStructureContract();
  testDocsLockedDecisionsPresent();
  // eslint-disable-next-line no-console
  console.log('✅ Guardrails OK');
}

main();



