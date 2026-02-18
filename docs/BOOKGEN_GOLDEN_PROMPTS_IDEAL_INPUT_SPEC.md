# Golden Prompts Generator - Ideal Input Format Specification

## Overview

This document describes the ideal input format for an AI agent interacting with the **BookGen Pro (Prince-first)** system.

The system takes **InDesign source exports** (IDML + chapter opener images) plus a **multi-book manifest** and produces:
- Canonical JSON (chapter/section/subparagraph structure)
- Skeleton-first rewrite artifacts (skeleton, rewrites, assembled JSON)
- Prince HTML + student-facing PDF output
- Validation reports (numbering/structure/layout)
- Real-time run telemetry to Supabase (runs/chapters/logs/issues)

**Important scope constraint**: This specification covers **only the Prince-first pipeline** (`new_pipeline/`). It must **not** introduce any InDesign “apply rewrites back into INDD” legacy flow.

---

## System Purpose

BookGen Pro is a “skeleton-first” book generation pipeline that:
1. Uses a canonical N4 source as the numbering/topic backbone (via a canonical IDML snapshot)
2. Converts content into a canonical JSON schema
3. Extracts a skeleton that pre-defines microheadings + box placement (Praktijk/Verdieping)
4. Runs LLM rewriting deterministically from the skeleton (Pass 1)
5. Assembles and renders a student-facing PDF via Prince XML
6. Runs mandatory validation gates
7. Reports progress and issues to Supabase for a real-time dashboard

**Output target**: student-facing PDFs only (KD-free).

---

## Ideal Input Structure

### Phase 1: Initial App Description

The ideal first message should include:

```
I want to build a Prince-first “book generation system” that converts InDesign IDML exports into validated student PDFs.

Books to support:
- [Book slug 1] (title: ...)
- [Book slug 2] (title: ...)

Inputs available per book:
- Canonical IDML snapshot path: [...]
- Optional chapter opener images folder path: [...]
- Optional figures mapping JSON path: [...]

Key features:
- Skeleton-first rewriting (microheadings + Praktijk generated, Verdieping selected from existing units)
- Deterministic output artifacts per chapter (skeleton/rewrites/assembled/html/pdf)
- Mandatory validation gates (numbering, JSON preflight, Prince layout suite)
- Supabase run telemetry (runs/chapters/logs/issues) + web dashboard

Users should be able to:
- Start a full-book run or per-chapter/per-section run
- See real-time progress, ETA, logs, and warnings/errors
- Resume/retry failed chapters without losing previous outputs
```

#### Required Elements

| Element | Description | Example |
|---------|-------------|---------|
| **Pipeline Mode** | Must be Prince-first only | “Prince-first; no InDesign apply” |
| **Source of Truth** | Multi-book manifest for scaling | `books/manifest.json` |
| **Canonical Snapshot** | Deterministic N4 IDML snapshot | `./_source_exports/...FROM_DOWNLOADS.idml` |
| **Output Target** | Student PDF (KD-free) | “student-facing PDFs only” |
| **Validation Gates** | Must be green before “validated” | numbering gate + JSON preflight + Prince validation suite |
| **LLM Provider/Models** | Models for planning + rewriting | planning: OpenAI `gpt-4o-mini`; rewriting: Anthropic `claude-sonnet-4-5-20250929` |
| **Telemetry** | Real Supabase (no dummy keys) | Supabase Realtime + Edge functions |

---

### Phase 2: Answering Clarifying Questions

The system will ask 3–7 clarifying questions. Ideal responses should be:

```
[Question topic]: [Specific answer]

Details:
- [Specification 1]
- [Specification 2]

Priority: [High/Medium/Low]
```

#### Common Clarifying Questions & Ideal Responses (BookGen Pro)

**1. Book Source-of-Truth & Scaling**
```
Q: What is the source of truth for book selection and numbering?

Ideal Answer:
Source of truth:
- Multi-book: books/manifest.json
- Numbering backbone: canonical N4 IDML snapshot exported from the canonical INDD

Details:
- Only chapter/paragraph/subparagraph keys that exist in the N4 snapshot may be used.
- subparagraph_number must exist (can be null).

Priority: High
```

**2. Primary Outputs**
```
Q: What are the required outputs per chapter and per book?

Ideal Answer:
Per chapter:
- canonical_chN_with_figures.json
- skeleton_chN.json
- rewrites_chN.json
- canonical_chN_with_figures.assembled.json
- canonical_chN_professional.pdf + prince log + html

Per book:
- canonical_book_with_figures.json
- canonical_book_with_figures.rewritten.json
- book_professional.pdf

Priority: High
```

**3. LLM Behavior & Box Semantics**
```
Q: How should Praktijk and Verdieping work?

Ideal Answer:
- Praktijk: LLM-generated extra unit inserted into skeleton (new content). Must be SKIPPED if not relevant.
- Verdieping: Selection of existing units (no new content). Minimum ~65 words; should be relatively complex.
- Microheadings: planned in skeleton before rewriting; applied as micro-title markers.

Priority: High
```

**4. Validation & “Green Gates”**
```
Q: What is required to call a run “validated”?

Ideal Answer:
Mandatory gates:
- Numbering gate: scripts/verify-json-numbering-vs-n4.py
- JSON structural gate: npm run preflight:json -- <json>
- Prince layout validation suite in new_pipeline/validate/ on the newest PDF

Priority: High
```

**5. Supabase/Edge Telemetry (Real-time Monitor)**
```
Q: What should the monitor store and show?

Ideal Answer:
Store:
- pipeline_runs, chapter_progress, log_entries, build_issues

Show:
- overall progress % + ETA
- per-chapter progress + section counts
- pass1/pass2/assembly/pdf status
- errors/warnings live stream

Priority: High
```

**6. Terminology & Student-facing Constraints**
```
Q: What terminology and student-facing constraints are non-negotiable?

Ideal Answer:
- Always use “zorgvrager” and “zorgprofessional”
- Never: patiënt/patient/cliënt/client/verpleegkundige
- Student output must be KD-free (no KD codes/tags/mentions)

Priority: High
```

---

### Phase 3: Triggering Prompt Generation

When ready to generate, use clear trigger phrases:

**Ideal Triggers:**
```
Generate my Golden Plan
I'm ready for the prompts
Create the prompt sequence
Generate the build prompts
```

**With Preferences:**
```
Generate my Golden Plan with focus on:
- Prince-first pipeline only
- Deterministic artifacts per chapter (no overwrites)
- Supabase realtime dashboard with run history
- Full prompt inventory included for reverse engineering
```

---

## Input Quality Spectrum

### Poor Input (Avoid)

```
Build a book generator.
```

**Problems:**
- No source of truth defined
- No gates/validations specified
- No clear LLM semantics for Praktijk/Verdieping
- No telemetry requirements

---

### Acceptable Input (Minimum Viable)

```
I want a pipeline that converts IDML to PDFs and tracks progress.
```

**Issues:**
- Missing deterministic artifact contract
- Missing numbering gate requirements
- Missing exact LLM prompt constraints

---

### Good Input (Recommended)

```
I want a Prince-first pipeline that takes canonical IDML snapshots and produces student PDFs.
It must extract a skeleton, run LLM rewrites from the skeleton, and validate output with our gates.
Also push run progress + logs to Supabase for a dashboard.
```

---

### Excellent Input (Ideal)

```
I want to build “BookGen Pro” — a Prince-first book generation system.

## Source of truth
- Multi-book manifest: books/manifest.json
- Canonical backbone: N4 IDML snapshot at ./_source_exports/...FROM_DOWNLOADS.idml

## Inputs per book
- IDML snapshot path (required)
- Chapter opener images folder (optional)
- Figures mapping JSON (optional)

## Pipeline (Prince-first only)
- Canonical JSON export/loading
- Skeleton extraction + planning (microheadings + verdieping selection + praktijk injection)
- Rewrite from skeleton (LLM)
- Assemble rewritten canonical JSON
- Render PDF via Prince
- Run mandatory validation gates

## LLM constraints
- N3 style everywhere (simple, direct)
- Praktijk generated only when relevant; otherwise SKIP
- Verdieping is selection of existing content; min ~65 words; no microheading inside
- Allowed markers: <<BOLD_START>>..<<BOLD_END>>, <<MICRO_TITLE>>..<<MICRO_TITLE_END>>

## Telemetry
- Real Supabase tables: runs/chapters/logs/issues
- Edge endpoints for starting runs and reporting progress/logs

## Out of scope
- InDesign apply (legacy)
- Teacher PDFs / KD appendix in student output
```

---

## Data Format Specifications

### Describing Entities

Use this structure for each data entity:

```
## Entity: BookManifestEntry

Purpose: One book’s canonical inputs and profiles used by the pipeline.

Fields:
| Field Name | Type | Required | Default | Notes |
|------------|------|----------|---------|-------|
| slug | string | yes | - | Stable identifier |
| title | string | yes | - | Book title |
| canonical_indd | string | yes | - | Canonical backbone reference (path) |
| canonical_idml | string | yes | - | Deterministic IDML snapshot |
| template_profile | string | yes | - | Prince template + token baseline |

Access Rules:
- Pipeline reads this as source of truth.
- No ad-hoc per-run overrides that bypass manifest unless explicitly recorded.
```

```
## Entity: PipelineRun

Purpose: A single execution of the pipeline for a book.

Fields:
| Field Name | Type | Required | Default | Notes |
|------------|------|----------|---------|-------|
| id | uuid | auto | generated | Primary key |
| book_slug | string | yes | - | Ties to manifest |
| status | enum | yes | 'running' | running, completed, failed |
| phase | enum | yes | - | tokens, canonical, skeleton, pass1, assembly, render, validate |
| progress_pct | number | yes | 0 | 0–100 |
| started_at | timestamp | auto | now() | - |
| completed_at | timestamp | no | - | - |

Access Rules:
- Admin-only in MVP.
```

### Describing Screens

```
## Screen: Dashboard

Route: /
Auth Required: yes
User Roles: Admin

UI Reference:
- pipeline-monitor/mockup.html (pixel-perfect HTML mockup for styling/layout)

Components:
1. Run summary card - book, phase, progress, ETA
2. Chapters grid - per-chapter progress + status
3. Activity log - streaming last N lines
4. Issues panel - errors/warnings (non-blocking vs blocking)

Actions Available:
- Start new run
- Stop run (best-effort)
- Retry chapter
```

### Describing User Flows

```
## Flow: Start Full Book Run

Trigger: Admin clicks “Start run”

Steps:
1. Admin selects book_slug → System creates pipeline_run
2. Runner picks up run → begins chapter loop
3. Runner streams progress/logs/issues to Supabase
4. System renders final PDF and runs validations

Success State: pipeline_run.status = completed; artifacts linked
Error States:
- LLM failure: retry with backoff; mark chapter failed if exceeds max
- Validation failure: mark as warning (non-blocking) vs blocking gate depending on class
```

---

## Conversation Examples

### Example 1: One-book MVP (Prince-first) + Supabase telemetry

**User Input:**

```
I want to build a Prince-first “book generation system” that converts InDesign IDML exports into validated student PDFs.

Books to support:
- pathologie_n4 (title: Pathologie N4, chapters: 12)

Inputs available:
- Canonical IDML snapshot path: ./_source_exports/pathologie_n4__FROM_DOWNLOADS.idml
- Chapter opener images folder: new_pipeline/assets/images/pathologie_n4_chapter_openers/

Key features:
- Skeleton-first rewriting (microheadings + Praktijk generated, Verdieping selected from existing units)
- Deterministic artifacts per chapter in new_pipeline/output/
- Mandatory gates: numbering gate + JSON preflight + Prince validation suite
- Supabase realtime dashboard with runs/chapters/logs/issues

Users should be able to:
- Start a full-book run and see ETA + per-chapter progress
- Rerun one chapter without overwriting other chapters
```

**System Response (expected):**
- Asks about authentication model for dashboard (single admin vs multiple users)
- Asks what constitutes a “blocking” vs “non-blocking” validation
- Asks which LLM models to pin for planning vs rewriting

---

### Example 2: Multi-book scalable system (12 books)

**User Input:**

```
I want to build BookGen Pro for 12 books using books/manifest.json as the source of truth.

Each book declares:
- canonical_idml snapshot path
- template profile / CSS base
- baseline token extraction chapter

The system should:
- run per-chapter (for speed + retry)
- accumulate outputs into a stable per-run folder (timestamped)
- publish telemetry to Supabase Realtime
- keep student output KD-free

Design preference:
- Dark monitor UI based on pipeline-monitor mockup
```

**System Response (expected):**
- Asks how to map “book slug” → manifest entry + assets
- Asks where to store run artifacts (local disk + optional Supabase Storage)
- Asks how retries should work (chapter-level idempotency rules)

---

## Anti-Patterns to Avoid

### 1. Introducing Legacy Apply-to-InDesign
```
Avoid any plan that writes back into INDD or relies on InDesign apply flows.
This system is Prince-first only.
```

### 2. Dropping Validation Gates
```
Avoid “we’ll validate later”.
Gates must be part of the pipeline contract.
```

### 3. “Invent new prompts” without audit
```
Avoid rewriting prompt templates ad-hoc.
Prompt strings must be extracted and preserved (see docs/BOOKGEN_PROMPTS_AUDIT.md).
```

---

## Output Expectations

After processing ideal input, the system generates:

1. **12–15 Sequential Golden Prompts** to build BookGen Pro MVP, covering:
   - Repo setup + Supabase schema + Edge endpoints
   - Prince-first pipeline runner
   - Deterministic artifact layout
   - LLM orchestration (planning + rewrite + editorial pass)
   - Validation gates
   - Realtime dashboard
   - Documentation (HANDOFF_SPEC.md)

2. **Each Prompt Includes:**
   - Clear, single-focus instruction
   - CONSTRAINTS section (what NOT to do)
   - VERIFICATION section (self-check items)

3. **Prompt Inventory Requirement**
   - The output must include (or link to) a verbatim prompt audit:
     - Planning prompt(s)
     - Rewrite prompt(s)
     - Editorial pass prompt(s)
     - Marker policies
   - Source: `docs/BOOKGEN_PROMPTS_AUDIT.md` (generated from this repo).

---

## Summary Checklist

Before submitting to the Golden Prompts Generator, ensure you've defined:

- [ ] Pipeline is **Prince-first only** (no InDesign apply)
- [ ] Multi-book source of truth is `books/manifest.json`
- [ ] Canonical N4 snapshot is declared (IDML path)
- [ ] Mandatory validation gates are listed
- [ ] LLM semantics are explicit (Praktijk generated/skip, Verdieping selection, microheadings planned in skeleton)
- [ ] Deterministic artifact contract is defined (paths and filenames)
- [ ] Supabase telemetry schema and realtime needs are defined
- [ ] Out-of-scope items are explicitly stated

---

## Version

Document Version: 1.0
Last Updated: 2025-12-29
Compatible With: BookGen Pro (Prince-first `new_pipeline/`)


