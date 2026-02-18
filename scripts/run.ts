import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { OpenAI } from 'openai';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/ai_lms';
const MCP_BASE_URL = process.env.MCP_URL || 'http://localhost:3001';
const TEMPLATE_NAME = process.env.INDESIGN_TEMPLATE || 'template.indd';
const TEXT_FRAME_NAME = process.env.INDESIGN_TEXT_FRAME_NAME || 'lesson-text';
const OUTPUT_PDF_NAME = process.env.OUTPUT_PDF || 'lesson.pdf';
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;

const templatePath = path.resolve('designs', TEMPLATE_NAME);
const outputPdfPath = path.resolve('output', OUTPUT_PDF_NAME);

const pool = new Pool({ connectionString: DATABASE_URL });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type Sample = { topic: string; text: string };

const samples: Sample[] = [
  {
    topic: 'grade 5 fractions introduction',
    text: 'Welcome to Grade 5 fractions. In this lesson, students learn to interpret fractions as division, compare fractional values, and represent them on a number line with clear visuals and real-world examples.'
  },
  {
    topic: 'grade 4 geometry basics',
    text: 'An introduction to lines, rays, and angles. Students identify parallel and perpendicular lines, measure angles with a protractor, and classify shapes based on their properties.'
  },
  {
    topic: 'grade 6 ratios and proportions',
    text: 'Students explore ratios, equivalent ratios, and unit rates. The lesson uses tables and double number lines to make proportional relationships clear.'
  }
];

function ensureDirectories() {
  ['designs', 'output', 'scripts', 'db'].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

function toVectorLiteral(vec: number[]) {
  return `[${vec.join(',')}]`;
}

function escapeJsx(str: string) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function buildSetFrameScript(frameName: string, content: string) {
  const escapedName = escapeJsx(frameName);
  const escapedContent = escapeJsx(content);
  return `
if (app.documents.length === 0) {
  "No document open";
} else {
  var doc = app.activeDocument;
  var target = null;

  // Search all text frames in the document
  for (var i = 0; i < doc.textFrames.length; i++) {
    var tf = doc.textFrames[i];
    if (tf.name === "${escapedName}" || tf.label === "${escapedName}") {
      target = tf;
      break;
    }
  }

  // Fallback: search first page specifically
  if (!target && doc.pages.length > 0) {
    var page = doc.pages[0];
    for (var j = 0; j < page.textFrames.length; j++) {
      var ptf = page.textFrames[j];
      if (ptf.name === "${escapedName}" || ptf.label === "${escapedName}") {
        target = ptf;
        break;
      }
    }
  }

  if (target) {
    target.contents = "${escapedContent}";
    "Updated text frame '${escapedName}'";
  } else {
    "Text frame not found: ${escapedName}";
  }
}
`;
}

async function embedText(text: string) {
  const resp = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIM
  });
  return resp.data[0].embedding;
}

async function seedContent() {
  for (const sample of samples) {
    const embedding = await embedText(sample.text);
    const vectorLiteral = toVectorLiteral(embedding);
    await pool.query('DELETE FROM content WHERE topic = $1', [sample.topic]);
    await pool.query(
      'INSERT INTO content (topic, text, embedding) VALUES ($1, $2, $3)',
      [sample.topic, sample.text, vectorLiteral]
    );
  }
}

async function findBestMatch(query: string) {
  const embedding = await embedText(query);
  const vectorLiteral = toVectorLiteral(embedding);
  const { rows } = await pool.query(
    'SELECT id, topic, text, (embedding <-> $1::vector) AS distance FROM content ORDER BY embedding <-> $1::vector ASC LIMIT 1',
    [vectorLiteral]
  );
  if (!rows.length) {
    throw new Error('No content available in the database. Seed failed.');
  }
  return rows[0] as { id: number; topic: string; text: string; distance: number };
}

async function callMcpTool(name: string, args: Record<string, unknown>) {
  const res = await fetch(`${MCP_BASE_URL}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, arguments: args })
  });

  if (!res.ok) {
    throw new Error(`MCP request failed with status ${res.status}`);
  }

  const data = await res.json();
  if (data?.success === false) {
    throw new Error(data.error || data.result || 'MCP tool returned an error');
  }

  return data;
}

async function run() {
  ensureDirectories();

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Missing template file at ${templatePath}. Place template.indd in the designs/ folder.`);
  }

  console.log('Seeding sample lesson content and embeddings...');
  await seedContent();

  const query = process.argv.slice(2).join(' ') || 'grade 5 fractions introduction';
  console.log(`Finding best match for query: "${query}"`);
  const best = await findBestMatch(query);
  console.log(`Selected topic: ${best.topic}`);

  console.log('Opening InDesign template...');
  await callMcpTool('open_document', { filePath: templatePath });

  console.log(`Updating text frame "${TEXT_FRAME_NAME}"...`);
  const jsx = buildSetFrameScript(TEXT_FRAME_NAME, best.text);
  await callMcpTool('execute_indesign_code', { code: jsx });

  console.log('Exporting PDF...');
  await callMcpTool('export_pdf', { filePath: outputPdfPath });

  console.log(`Done. PDF exported to ${outputPdfPath}`);
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

