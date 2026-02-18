# Runbook: INDD → Postgres → Embeddings Pipeline

This guide shows how to run the local InDesign MCP server, Postgres (with pgvector), and the extract/embed workflows in this project.

## Prerequisites
- macOS with Adobe InDesign installed and running.
- Node 20 available on PATH (if needed, prefix commands with `PATH="/opt/homebrew/opt/node@20/bin:$PATH"`).
- Postgres 15 with `pgvector` installed. The service is already set to run via Homebrew.
- Repository root: `/Users/asafgafni/Desktop/InDesign/TestRun`

## 1) Environment setup
```bash
cd /Users/asafgafni/Desktop/InDesign/TestRun
cp env.example .env
# Edit .env and set:
# DATABASE_URL=postgres://localhost:5432/ai_books   # or your DB
# OPENAI_API_KEY=sk-...
# MCP_URL=http://127.0.0.1:3001
```

Optional: set `.cursor/mcp.json` from `mcp.example.json` if your tooling uses it.

## 2) Install dependencies
```bash
cd /Users/asafgafni/Desktop/InDesign/TestRun
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm install
```

## 3) Start Postgres
Homebrew service (already configured):
```bash
/opt/homebrew/bin/brew services start postgresql@15
```

## 4) Start the InDesign MCP server (HTTP, port 3001)
In a separate terminal:
```bash
cd /Users/asafgafni/Desktop/InDesign/TestRun/Projects/indesign-mcp-server
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm install   # if not already
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm start
```
This serves HTTP at `http://127.0.0.1:3001` with `/message` and `/stream`.

## 5) Apply database schema
Back in the project root:
```bash
cd /Users/asafgafni/Desktop/InDesign/TestRun
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run migrate
```
This runs `db/001_init.sql` (creates `content`, `content_versions`, pgvector index, trigger).

## 6) Prepare InDesign inputs
- Place `.indd` files in `designs/` (or set `INDESIGN_INPUT_DIR` in `.env`).
- Ensure InDesign is running; the MCP server will open these files.

## 7) Extract text from INDD to Postgres (and JSON)
```bash
cd /Users/asafgafni/Desktop/InDesign/TestRun
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run extract
```
Outputs:
- Upserts normalized stories into the `content` table.
- Writes `output/extracted.json`.

## 8) Embed canonical text into pgvector
```bash
cd /Users/asafgafni/Desktop/InDesign/TestRun
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run embed
```
Optional semantic check:
```bash
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run embed -- --query "grade 5 fractions"
```

## 9) End-to-end checklist (one possible layout)
- Terminal 1: Start Postgres service (if not already).
- Terminal 2: Start MCP server (`npm start` in `Projects/indesign-mcp-server`).
- Terminal 3: Project root
  - `npm run migrate`
  - `npm run extract`
  - `npm run embed`

## 10) Notes and troubleshooting
- If Node resolves to v24 on PATH, prefix commands with `PATH="/opt/homebrew/opt/node@20/bin:$PATH"`.
- Ensure `OPENAI_API_KEY` is set for embeddings; without it, `embed` will fail.
- MCP must run locally (no ngrok). URL defaults to `http://127.0.0.1:3001`.
- The schema defaults to database `ai_books`; change `.env` if you prefer another DB. 

