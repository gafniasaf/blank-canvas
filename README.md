# Local INDD Extraction & Embedding Pipeline

This project automates extracting text from InDesign (`.indd`) files via the local InDesign MCP server, normalizes and upserts it into Postgres (with pgvector), and batches embeddings for semantic search.

## Prerequisites
- macOS with Adobe InDesign installed and running.
- InDesign MCP server running locally (HTTP): `node Projects/indesign-mcp-server/src/http-server.js` (default `http://127.0.0.1:3001`).
- Postgres with `pgvector` installed (e.g., `brew install postgresql@16` then `CREATE EXTENSION vector;`).
- Node 18+.

## Setup
1) Copy env template:
   - `cp env.example .env` (then set `DATABASE_URL`, `OPENAI_API_KEY`, `MCP_URL`, paths).
2) Install deps: `npm install`.
3) Apply schema: `npm run migrate` (requires `psql` on PATH).
4) Place INDD files under `designs/` (or set `INDESIGN_INPUT_DIR`).

MCP config: a sample is in `mcp.example.json`. If your tooling supports `.cursor/mcp.json`, point it at `http://127.0.0.1:3001`.

## Commands
- Extract & ingest INDD stories to Postgres and JSON:
  - `npm run extract`
  - Output JSON: `output/extracted.json`.
- Embed canonical text into pgvector:
  - `npm run embed`
  - Optional semantic check: `npm run embed -- --query "grade 5 fractions"`.

## Schema (pgvector)
`db/001_init.sql` creates:
- `content`: canonical rows (`content_id`, `source_text`, `validated_text`, `status`, `metadata`, `embedding vector(1536)`).
- `content_versions`: versioned text history.
- IVFFLAT index on `content.embedding`, plus supporting indexes.

## Text normalization
Extraction normalizes whitespace, removes hyphenated line breaks, collapses multi-blank lines, and trims.

