# BookGen — Book Publishing Pipeline

End-to-end automated pipeline for generating, rendering, and validating educational books. Includes an InDesign extraction layer, a Supabase-backed job queue with worker strategies, and a real-time React dashboard for monitoring.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌────────────────────┐
│  Pipeline        │     │  BookGen Worker   │     │  Dashboard (React) │
│  CLI / MCP       │────▶│  (runner.ts)      │◀───▶│  Real-time UI      │
│  enqueue/monitor │     │  11 strategies    │     │  Jobs · Books · Log│
└─────────────────┘     └──────────────────┘     └────────────────────┘
         │                       │
         ▼                       ▼
   ┌───────────┐         ┌──────────────┐
   │ Supabase  │         │ PrinceXML /  │
   │ Postgres  │         │ Puppeteer    │
   │ + pgvector│         │ PDF render   │
   └───────────┘         └──────────────┘
```

## Modules

| Directory | Purpose |
|---|---|
| `bookgen/` | Main app — React dashboard + worker runner + MCP server |
| `bookgen/src/strategies/` | Pipeline step implementations (generate, assemble, render, validate…) |
| `bookgen/cli/` | CLI tools: `enqueue`, `monitor`, `status` |
| `bookgen/bookgen-mcp/` | MCP server for AI agent control plane |
| `new_pipeline/` | HTML/PDF rendering pipeline (PrinceXML, design tokens, validation) |
| `worker/` | Dockerized worker for cloud deployment (Node + Python + PrinceXML) |
| `db/` | Postgres schema migrations (pgvector) |

## Prerequisites

- Node 18+
- macOS with Adobe InDesign (for INDD extraction)
- Postgres with `pgvector` extension
- PrinceXML (for PDF rendering)
- Python 3 with `pdfplumber`, `numpy` (for validation scripts)

## Setup

1. Copy env template: `cp env.example .env`
2. Set required vars: `DATABASE_URL`, `OPENAI_API_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
3. Install dependencies: `npm install`
4. Apply DB schema: `npm run migrate`

## Commands

### Dashboard (React UI)
```bash
cd bookgen
npm run dev          # Start dev server with HMR
npm run build        # Production build
```

### Worker
```bash
cd bookgen
npm run dev:worker   # Start job polling worker
npm run dev:mcp      # Start MCP control plane server
```

### CLI
```bash
cd bookgen
npm run cli:enqueue  # Queue a new pipeline job
npm run cli:monitor  # Watch job progress
npm run cli:status   # Check pipeline status
```

### INDD Extraction
```bash
npm run extract      # Extract stories from INDD → Postgres + JSON
npm run embed        # Batch-embed text into pgvector
```

### PDF Rendering (new_pipeline)
```bash
cd new_pipeline
npm run build:ch1    # Full chapter build: tokens → export → render → validate
npm run render       # Render HTML to PDF via PrinceXML
```

## Dashboard

The React dashboard (`bookgen/src/`) provides:

- **Book Registry** — view all registered books with metadata
- **Job Table** — live status of all pipeline jobs (pending, running, done, failed)
- **Event Log** — real-time stream of pipeline events
- **Stats Bar** — aggregate counts by job status

Connects to Supabase for real-time updates via `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Falls back to demo data when not connected.

## Database Schema

`db/001_init.sql` creates:
- `content` — canonical text rows with `embedding vector(1536)`
- `content_versions` — versioned text history
- `book_registry` — registered books and metadata
- `pipeline_jobs` — job queue with status tracking
- `pipeline_events` — event log for real-time monitoring

## Docker (Cloud Worker)

```bash
docker build -f worker/Dockerfile -t bookgen-worker .
docker run --env-file .env bookgen-worker
```

## License

Private — all rights reserved.

---
*Last synced from Lovable: 2026-02-18*
