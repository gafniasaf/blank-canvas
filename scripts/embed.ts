import 'dotenv/config';
import { Pool } from 'pg';
import { OpenAI } from 'openai';

type EmbeddableRow = { id: number; content_id: string; text: string };

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/ai_books';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const EMBEDDING_DIM = Number(process.env.EMBEDDING_DIM || 1536);
const BATCH_SIZE = Number(process.env.EMBED_BATCH_SIZE || 50);
const MAX_ROWS = Number(process.env.MAX_ROWS_PER_RUN || 0); // 0 = no limit

const pool = new Pool({ connectionString: DATABASE_URL });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function toVectorLiteral(vec: number[]) {
  return `[${vec.join(',')}]`;
}

async function fetchRows(): Promise<EmbeddableRow[]> {
  const limit = MAX_ROWS > 0 ? Math.min(MAX_ROWS, BATCH_SIZE) : BATCH_SIZE;
  const { rows } = await pool.query<EmbeddableRow>(
    `
    SELECT id, content_id, COALESCE(validated_text, source_text) as text
    FROM content
    WHERE embedding IS NULL
      AND COALESCE(validated_text, source_text) IS NOT NULL
    ORDER BY id
    LIMIT $1
  `,
    [limit]
  );
  return rows;
}

async function embedBatch(texts: string[]) {
  const resp = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
    dimensions: EMBEDDING_DIM
  });
  return resp.data.map((d) => d.embedding);
}

async function processBatch(rows: EmbeddableRow[]) {
  const embeddings = await embedBatch(rows.map((r) => r.text));
  for (let i = 0; i < rows.length; i++) {
    const vectorLiteral = toVectorLiteral(embeddings[i]);
    await pool.query('UPDATE content SET embedding = $1 WHERE id = $2', [vectorLiteral, rows[i].id]);
  }
}

async function search(query: string) {
  const embedding = await embedBatch([query]);
  const vectorLiteral = toVectorLiteral(embedding[0]);
  const { rows } = await pool.query(
    `
    SELECT content_id, COALESCE(validated_text, source_text) AS text,
           (embedding <-> $1::vector) AS distance
    FROM content
    WHERE embedding IS NOT NULL
    ORDER BY embedding <-> $1::vector
    LIMIT 5
  `,
    [vectorLiteral]
  );
  return rows;
}

async function main() {
  const queryArgIndex = process.argv.indexOf('--query');
  if (queryArgIndex >= 0) {
    const q = process.argv.slice(queryArgIndex + 1).join(' ');
    if (!q) throw new Error('Provide a query after --query');
    const results = await search(q);
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  let processed = 0;
  while (true) {
    const rows = await fetchRows();
    if (!rows.length) {
      console.log('No more rows to embed.');
      break;
    }
    console.log(`Embedding batch of ${rows.length}...`);
    await processBatch(rows);
    processed += rows.length;
    if (MAX_ROWS > 0 && processed >= MAX_ROWS) {
      console.log(`Reached MAX_ROWS_PER_RUN (${MAX_ROWS}).`);
      break;
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

