# Platform Upgrade Plan: Ignite Control Plane + Docker Worker

This document outlines the architecture and implementation steps to upgrade the local pipeline into a robust, scalable platform.

**Goal**: Move from a local file-based pipeline to a split architecture:
1.  **Control Plane (Ignite)**: Supabase-based. Manages jobs, artifacts, logs, and UI.
2.  **Execution Plane (Worker)**: Docker-based. Runs the existing `new_pipeline` code to generate PDFs.

---

## 1. Architecture Overview

### A. The Split
| Feature | Control Plane (Supabase + Next.js) | Execution Plane (Docker Worker) |
| :--- | :--- | :--- |
| **Responsibility** | Orchestration, Storage, UI, Auth | Heavy lifting (Rendering, LLM calls) |
| **State** | `jobs`, `job_logs`, `artifacts` tables | Stateless (processes 1 job -> exit) |
| **Input** | User clicks "Build Chapter 1" | Receives `job_id` + inputs (JSON URLs) |
| **Output** | Live progress UI, Download links | Uploads PDF/JSON to Storage |
| **Communication** | REST API / Postgres Realtime | HTTP Polling or Queue Worker |

### B. Data Flow
1.  **Enqueue**: User requests build → Row created in `jobs` table (status: `queued`).
2.  **Pickup**: Worker polls `jobs` (or triggered via webhook) → Updates status to `processing`.
3.  **Run**: Worker pulls Canonical JSON + Assets → Runs `build:chapter`.
4.  **Telemetry**: Worker streams logs/progress to `job_logs` / `jobs` table (real-time).
5.  **Finish**: Worker uploads PDF to Supabase Storage → Records in `artifacts` table → Updates job to `completed`.

---

## 2. Implementation Steps

### Phase 1: Database & Storage (The Contract)
*   [ ] **Schema**: Create tables for `jobs`, `job_logs`, `artifacts`, `book_versions`.
*   [ ] **Storage**: Create buckets for `input-assets` (IDML/Images) and `build-artifacts` (PDFs).
*   [ ] **RLS**: Secure tables so only authenticated workers can write logs/artifacts.

### Phase 2: The Docker Worker
*   [ ] **Dockerfile**: Pack Node.js, Python, and PrinceXML into a single image.
*   [ ] **Worker Entrypoint**: A TypeScript wrapper around `build:chapter` that:
    *   Fetches job details.
    *   Resolves inputs (downloads JSON/Figures from Storage).
    *   Invokes the pipeline.
    *   Captures stdout/stderr -> pushes to DB.
    *   Uploads results.

### Phase 3: Dashboard Upgrade
*   [ ] **Remove Log Tailing**: Stop reading `/tmp/*.log`.
*   [ ] **Real-time UI**: Connect React app to Supabase `jobs` table (live progress bars).
*   [ ] **Artifact Browser**: List and download generated PDFs directly from UI.

---

## 3. Infrastructure Artifacts

### A. Database Schema (`supabase/schema.sql`)
Defines the `jobs` queue and artifact registry.

### B. Worker Definition (`worker/Dockerfile`)
The reproducible runtime environment.

### C. API Contract (`worker/src/types.ts`)
Strict typing for Job Inputs/Outputs.

---

## 4. Migration Strategy
1.  **Parallel Run**: Keep local `new_pipeline` running for dev.
2.  **Deploy Control Plane**: Set up Supabase project.
3.  **Connect Worker**: Run Docker container pointing to local `new_pipeline` code (mounted volume) for testing.
4.  **Full Switch**: Point UI to Supabase; run Worker in cloud (e.g., Fly.io / AWS).











