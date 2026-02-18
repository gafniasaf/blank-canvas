import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

type StoryExtract = {
  content_id: string;
  book: string;
  story_index: number;
  story_name: string;
  text: string;
  overset: boolean;
  source_path: string;
};

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/ai_books';
const MCP_URL = process.env.MCP_URL || 'http://127.0.0.1:3001';
const INPUT_DIR = process.env.INDESIGN_INPUT_DIR || 'designs';
const OUTPUT_JSON = process.env.EXTRACT_OUTPUT_JSON || 'output/extracted.json';

const pool = new Pool({ connectionString: DATABASE_URL });

async function callMcpTool<T = any>(name: string, args: Record<string, unknown>) {
  const res = await fetch(`${MCP_URL}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, arguments: args })
  });

  if (!res.ok) {
    throw new Error(`MCP request failed (${res.status})`);
  }

  const data = (await res.json()) as { success?: boolean; result?: any; error?: string };
  if (data?.success === false) {
    throw new Error(data.error || data.result || 'MCP tool returned an error');
  }
  return data.result as T;
}

function ensureDirExists(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function listInddFiles(root: string) {
  if (!fs.existsSync(root)) return [];
  const entries = fs.readdirSync(root);
  return entries
    .filter((f) => f.toLowerCase().endsWith('.indd'))
    .map((f) => path.resolve(root, f));
}

function slugifyBase(filePath: string) {
  return path.basename(filePath, path.extname(filePath)).replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();
}

function normalizeText(text: string) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/-\n/g, '') // unwrap hyphenated line breaks
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function parseTotalStories(summary: string) {
  const match = summary.match(/Total Stories:\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : 0;
}

function parseStoryContent(result: string) {
  // The handler returns a structured text block; grab name, overset, and full text after the marker.
  const nameMatch = result.match(/Name:\s*(.+)/);
  const oversetMatch = result.match(/Overset:\s*(.+)/);
  const textPart = result.split('--- Full Text ---')[1] || '';
  const cleaned = textPart.replace(/^\s+|\s+$/g, '').trim();
  return {
    name: nameMatch ? nameMatch[1].trim() : 'Untitled',
    overset: oversetMatch ? oversetMatch[1].toLowerCase().includes('true') : false,
    text: cleaned
  };
}

async function upsertContent(row: StoryExtract) {
  const normalized = normalizeText(row.text);
  if (!normalized) return;
  await pool.query(
    `
    INSERT INTO content (content_id, book, section, topic, source_text, status, metadata)
    VALUES ($1, $2, $3, $4, $5, 'raw', $6)
    ON CONFLICT (content_id) DO UPDATE
      SET book = EXCLUDED.book,
          section = EXCLUDED.section,
          topic = EXCLUDED.topic,
          source_text = EXCLUDED.source_text,
          status = 'raw',
          metadata = EXCLUDED.metadata,
          updated_at = now()
  `,
    [
      row.content_id,
      row.book,
      `story_${row.story_index + 1}`,
      row.story_name,
      normalized,
      {
        story_index: row.story_index,
        overset: row.overset,
        source_path: row.source_path
      }
    ]
  );
}

async function extractFromFile(filePath: string): Promise<StoryExtract[]> {
  console.log(`Opening ${filePath}`);
  await callMcpTool('open_document', { filePath });

  const summary = await callMcpTool<string>('get_document_stories', { includeOverset: true, includeHidden: false });
  const total = parseTotalStories(summary);
  if (total === 0) {
    console.warn(`No stories found in ${filePath}`);
    return [];
  }

  const book = slugifyBase(filePath);
  const results: StoryExtract[] = [];

  for (let i = 0; i < total; i++) {
    const storyText = await callMcpTool<string>('get_story_content', {
      storyIndex: i,
      includeParagraphs: false,
      maxParagraphCharacters: 0
    });
    const parsed = parseStoryContent(storyText);
    const content_id = `${book}_story_${i + 1}`;
    results.push({
      content_id,
      book,
      story_index: i,
      story_name: parsed.name,
      text: parsed.text,
      overset: parsed.overset,
      source_path: filePath
    });
  }

  return results;
}

async function main() {
  ensureDirExists('output');

  const files = listInddFiles(INPUT_DIR);
  if (!files.length) {
    throw new Error(`No .indd files found in ${path.resolve(INPUT_DIR)}`);
  }

  const allExtracts: StoryExtract[] = [];

  for (const file of files) {
    const extracts = await extractFromFile(file);
    for (const row of extracts) {
      await upsertContent(row);
    }
    allExtracts.push(...extracts);
  }

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(allExtracts, null, 2), 'utf8');
  console.log(`Saved extracted stories to ${OUTPUT_JSON}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

