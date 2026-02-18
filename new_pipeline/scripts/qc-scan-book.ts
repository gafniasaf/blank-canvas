import fs from 'fs';

type AnyObj = Record<string, any>;

function normalizeForCompare(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripLeadingDutchArticle(s: string): { article: string | null; noun: string } {
  const t = String(s || '').trim();
  const m = /^(de|het|een)\s+(.+)$/iu.exec(t);
  if (!m) return { article: null, noun: t };
  return { article: String(m[1] || '').toLowerCase(), noun: String(m[2] || '').trim() };
}

function parseLeadingMicroTitle(s: string): { title: string; rest: string } | null {
  const raw = String(s || '');
  const m = /^\s*<<MICRO_TITLE>>([\s\S]*?)<<MICRO_TITLE_END>>\s*/u.exec(raw);
  if (!m) return null;
  const title = String(m[1] || '').trim();
  const rest = raw.slice(m[0].length);
  return { title, rest };
}

function walkBlocks(blocks: any[], cb: (b: any) => void) {
  if (!Array.isArray(blocks)) return;
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    cb(b);
    if (Array.isArray(b.content)) walkBlocks(b.content, cb);
    // Some schemas nest as sections: { content: [...] }
    if (b.content && Array.isArray((b.content as any).content)) walkBlocks((b.content as any).content, cb);
  }
}

function getSubparagraphFirstTextCandidate(sub: any): string | null {
  // Find first paragraph-like block under this subparagraph that has basis text.
  let found: string | null = null;
  walkBlocks(sub.content || [], (b) => {
    if (found) return;
    if (b.type === 'paragraph' && typeof b.basis === 'string' && b.basis.trim()) {
      found = String(b.basis || '');
    }
  });
  return found;
}

function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) {
    console.error('Usage: tsx new_pipeline/scripts/qc-scan-book.ts <book_json>');
    process.exit(1);
  }

  const raw = fs.readFileSync(jsonPath, 'utf8');
  const book = JSON.parse(raw) as AnyObj;

  const title = String(book?.meta?.title || 'Unknown');
  const chapters = Array.isArray(book?.chapters) ? book.chapters : [];

  let emptySectionTitles = 0;
  let sectionCount = 0;

  const microDup: Array<{ ch: string; sec: string; sub: string; subTitle: string; micro: string }> = [];
  const microFunMissingArticle: Array<{ ch: string; sec: string; sub: string; subTitle: string; micro: string }> = [];

  // Scan sections/subparagraphs
  for (const ch of chapters) {
    const chNum = String(ch?.number || '');
    const sections = Array.isArray(ch?.sections) ? ch.sections : [];
    for (const sec of sections) {
      sectionCount++;
      const secNum = String(sec?.number || '');
      const secTitle = String(sec?.title || '').trim();
      if (!secTitle) emptySectionTitles++;

      const content = Array.isArray(sec?.content) ? sec.content : [];
      for (const b of content) {
        if (!b || typeof b !== 'object') continue;
        if (b.type !== 'subparagraph') continue;
        const subNum = String(b?.number || b?.id || '');
        const subTitle = String(b?.title || '').trim();
        if (!subTitle) continue;

        const firstBasis = getSubparagraphFirstTextCandidate(b);
        if (!firstBasis) continue;
        const lead = parseLeadingMicroTitle(firstBasis);
        if (!lead) continue;

        const micro = lead.title;
        const microNorm = normalizeForCompare(micro);
        const subNorm = normalizeForCompare(subTitle);
        const { article, noun } = stripLeadingDutchArticle(subTitle);
        const nounNorm = normalizeForCompare(noun);

        if (microNorm && (microNorm === subNorm || (article && noun && microNorm === nounNorm))) {
          microDup.push({ ch: chNum, sec: secNum, sub: subNum, subTitle, micro });
        }

        const fun = /^functies van\s+(.+)$/iu.exec(micro);
        if (fun && article) {
          const tail = String(fun[1] || '').trim();
          if (normalizeForCompare(tail) === nounNorm) {
            microFunMissingArticle.push({ ch: chNum, sec: secNum, sub: subNum, subTitle, micro });
          }
        }
      }
    }
  }

  const report = {
    book: title,
    sections: sectionCount,
    empty_section_titles: emptySectionTitles,
    microtitle_repeats_subtitle: microDup.length,
    microtitle_fun_missing_article: microFunMissingArticle.length,
    examples: {
      microtitle_repeats_subtitle: microDup.slice(0, 5),
      microtitle_fun_missing_article: microFunMissingArticle.slice(0, 5),
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main();


