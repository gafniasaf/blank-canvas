/**
 * Extract design tokens from an IDML snapshot (deterministic, no InDesign needed).
 *
 * This is a best-effort extractor meant to match the output shape of
 * `export-design-tokens.jsx` so the CSS generator can run headlessly.
 *
 * Usage:
 *   npx tsx new_pipeline/extract/parse-idml-design-tokens.ts <path-to-idml> [--out <tokens.json>]
 *
 * Example:
 *   npx tsx new_pipeline/extract/parse-idml-design-tokens.ts \
 *     _source_exports/MBO_A&F_4_9789083251370_03.2024__FROM_DOWNLOADS.idml \
 *     --out new_pipeline/extract/design_tokens.json
 */

import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import xml2js from 'xml2js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MM_PER_PT = 25.4 / 72;

function ptToMm(pt: number): number {
  return pt * MM_PER_PT;
}

function isoStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return null;
  return v;
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function getArgInt(flag: string): number | null {
  const v = getArg(flag);
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function nodeText(v: any): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object' && typeof v._ === 'string') return v._;
  return null;
}

function parseNum(v: any): number | null {
  const t = nodeText(v);
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function stripRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const s = String(ref);
  const parts = s.split('/');
  return parts[parts.length - 1] || s;
}

function parseItemTransformX(itemTransform: string | undefined | null): number | null {
  if (!itemTransform) return null;
  const parts = String(itemTransform)
    .trim()
    .split(/\s+/g)
    .map((x) => Number(x));
  if (parts.length < 6) return null;
  const tx = parts[4];
  return Number.isFinite(tx) ? tx : null;
}

type Tokens = {
  meta: {
    exportedAt: string;
    source: 'idml';
    idmlPath: string;
    chapterNumber?: number;
    layoutMasterSelf?: string;
    layoutMasterName?: string;
  };
  page: {
    widthPt: number;
    heightPt: number;
    widthMm: number;
    heightMm: number;
    facingPages: boolean;
  };
  marginsAndColumns: {
    left: {
      topMm: number;
      bottomMm: number;
      leftMm: number;
      rightMm: number;
      columnCount: number;
      columnGutterMm: number;
    } | null;
    right: {
      topMm: number;
      bottomMm: number;
      leftMm: number;
      rightMm: number;
      columnCount: number;
      columnGutterMm: number;
    } | null;
  };
  baselineGrid: {
    baselineStartMm: number | null;
    baselineDivisionMm: number | null;
  };
  textFrames: {
    representative: {
      textColumnCount: number | null;
      textColumnGutterMm: number | null;
    } | null;
  };
  paragraphStyles: Array<{
    name: string;
    path: string;
    basedOn: string | null;
    nextStyle: string | null;
    appliedFont: { family: string; style?: string; name?: string } | null;
    pointSize: number | null;
    leading: number | null;
    fillColor: string | null;
    justification: string | null;
    hyphenation: boolean | null;
    spaceBeforePt?: number | null;
    spaceAfterPt?: number | null;
    leftIndentPt?: number | null;
    rightIndentPt?: number | null;
    firstLineIndentPt?: number | null;
    hyphenationZonePt?: number | null;
    bulletsAndNumberingListType?: string | null;
    bulletCharCode?: number | null;
  }>;
  characterStyles: Array<{
    name: string;
    path: string;
    basedOn: string | null;
    appliedFont: { family: string; style?: string; name?: string } | null;
    pointSize: number | null;
    fillColor: string | null;
  }>;
  objectStyles: Array<{
    name: string;
    path: string;
    basedOn: string | null;
    fillColor: string | null;
    strokeColor: string | null;
    strokeWeight: number | null;
  }>;
  swatches: Array<{
    name: string;
    space: string | null;
    model: string | null;
    colorValue: number[] | null;
  }>;
};

function findStoryIdsForChapter(opts: {
  zip: AdmZip;
  chapterNumber: number;
}): { startStoryIds: Set<string>; endStoryIds: Set<string> } {
  const { zip, chapterNumber } = opts;
  const startRe = new RegExp(`(?:<Content>\\s*|\\b)${chapterNumber}\\.1\\s`, 'm');
  const endRe = new RegExp(`(?:<Content>\\s*|\\b)${chapterNumber + 1}\\.1\\s`, 'm');

  const startStoryIds = new Set<string>();
  const endStoryIds = new Set<string>();

  for (const entry of zip.getEntries()) {
    const name = entry.entryName;
    if (!name.startsWith('Stories/Story_') || !name.endsWith('.xml')) continue;
    const xml = entry.getData().toString('utf8');

    if (startRe.test(xml)) {
      const m = name.match(/Stories\/Story_(u[0-9a-z]+)\.xml$/i);
      if (m) startStoryIds.add(m[1]);
    }
    if (endRe.test(xml)) {
      const m = name.match(/Stories\/Story_(u[0-9a-z]+)\.xml$/i);
      if (m) endStoryIds.add(m[1]);
    }
  }

  return { startStoryIds, endStoryIds };
}

async function main() {
  const idmlArg = process.argv[2];
  if (!idmlArg) {
    console.error('Usage: npx tsx new_pipeline/extract/parse-idml-design-tokens.ts <path-to-idml> [--out <tokens.json>]');
    process.exit(1);
  }

  const repoRoot = path.resolve(__dirname, '../..');
  const idmlPath = path.resolve(repoRoot, idmlArg);
  if (!fs.existsSync(idmlPath)) {
    console.error(`❌ IDML not found: ${idmlPath}`);
    process.exit(1);
  }

  const chapterNumber = getArgInt('--chapter');
  const outPath = path.resolve(repoRoot, getArg('--out') || 'new_pipeline/extract/design_tokens.json');
  const zip = new AdmZip(idmlPath);
  const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });

  // Detect the dominant applied master spread (layout master) by scanning spreads.
  // This is important because document-level preferences often differ from the body master grid.
  let layoutMasterSelf: string | null = null;
  let layoutMasterName: string | null = null;
  let layoutMasterMargins: {
    left?: any;
    right?: any;
  } | null = null;

  try {
    const dmEntry = zip.getEntry('designmap.xml');
    if (dmEntry) {
      const dm = await parser.parseStringPromise(dmEntry.getData().toString('utf8'));
      const doc = dm.Document;
      const spreads = Array.isArray(doc['idPkg:Spread']) ? doc['idPkg:Spread'] : doc['idPkg:Spread'] ? [doc['idPkg:Spread']] : [];
      const masters = Array.isArray(doc['idPkg:MasterSpread'])
        ? doc['idPkg:MasterSpread']
        : doc['idPkg:MasterSpread']
          ? [doc['idPkg:MasterSpread']]
          : [];

      // Spread src order (for determining chapter range)
      const spreadSrcs: string[] = spreads.map((s: any) => s.src).filter(Boolean);

      // Build storyId -> firstSpreadIdx map (regex for ParentStory)
      const storyFirstSpreadIdx = new Map<string, number>();
      for (let i = 0; i < spreadSrcs.length; i++) {
        const src = spreadSrcs[i];
        const e = zip.getEntry(src);
        if (!e) continue;
        const xml = e.getData().toString('utf8');
        for (const m of xml.matchAll(/ParentStory=\"([^\"]+)\"/g)) {
          const sid = m[1];
          if (!sid || sid === 'n') continue;
          if (!storyFirstSpreadIdx.has(sid)) storyFirstSpreadIdx.set(sid, i);
        }
      }

      // If chapterNumber specified, compute chapter spread range by story markers.
      let chapterStartIdx: number | null = null;
      let chapterEndIdx: number | null = null;
      if (chapterNumber) {
        const { startStoryIds, endStoryIds } = findStoryIdsForChapter({ zip, chapterNumber });

        const idxsStart = Array.from(startStoryIds)
          .map((sid) => storyFirstSpreadIdx.get(sid))
          .filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
        const idxsEnd = Array.from(endStoryIds)
          .map((sid) => storyFirstSpreadIdx.get(sid))
          .filter((x): x is number => typeof x === 'number' && Number.isFinite(x));

        if (idxsStart.length) chapterStartIdx = Math.min(...idxsStart);
        if (idxsEnd.length) {
          // Choose earliest end spread after start
          const candidates = idxsEnd.filter((i) => chapterStartIdx === null || i > chapterStartIdx);
          if (candidates.length) chapterEndIdx = Math.min(...candidates);
        }

        // If we couldn't find an end marker, run to end of document.
        if (chapterStartIdx !== null && chapterEndIdx === null) chapterEndIdx = spreadSrcs.length;
      }

      const masterCounts = new Map<string, number>();

      for (let i = 0; i < spreads.length; i++) {
        if (chapterStartIdx !== null && i < chapterStartIdx) continue;
        if (chapterEndIdx !== null && i >= chapterEndIdx) continue;
        const s = spreads[i];
        const src = s.src;
        const e = src ? zip.getEntry(src) : null;
        if (!e) continue;
        const xml = e.getData().toString('utf8');
        for (const m of xml.matchAll(/AppliedMaster=\"([^\"]+)\"/g)) {
          const id = m[1];
          if (!id || id === 'n') continue;
          masterCounts.set(id, (masterCounts.get(id) || 0) + 1);
        }
      }

      const sorted = Array.from(masterCounts.entries()).sort((a, b) => b[1] - a[1]);
      if (sorted.length) {
        layoutMasterSelf = sorted[0][0];

        // Resolve master name and file path via designmap (best-effort)
        let masterSrc: string | null = null;
        for (const ms of masters) {
          const src = ms.src;
          if (src && src.indexOf(`MasterSpread_${layoutMasterSelf}.xml`) !== -1) {
            masterSrc = src;
            break;
          }
        }
        if (!masterSrc) masterSrc = `MasterSpreads/MasterSpread_${layoutMasterSelf}.xml`;

        const msEntry = zip.getEntry(masterSrc);
        if (msEntry) {
          const msXml = await parser.parseStringPromise(msEntry.getData().toString('utf8'));
          const ms = msXml['idPkg:MasterSpread']?.MasterSpread;
          if (ms) {
            layoutMasterName = ms.Name ? String(ms.Name) : null;
            const pages = asArray<any>(ms.Page);
            // Pick left/right pages by tx: left has negative tx ~ -pageWidth, right has tx ~ 0.
            const withTx = pages
              .map((p) => ({ p, tx: parseItemTransformX(p.ItemTransform) }))
              .filter((x) => typeof x.tx === 'number' && Number.isFinite(x.tx));
            withTx.sort((a, b) => (a.tx as number) - (b.tx as number));
            const left = withTx.length ? withTx[0].p : pages[0];
            const right = withTx.length ? withTx[withTx.length - 1].p : pages[Math.min(1, pages.length - 1)];
            layoutMasterMargins = { left: left?.MarginPreference, right: right?.MarginPreference };
          }
        }
      }
    }
  } catch {
    // Ignore; fall back to document-level Preferences.xml
  }

  const prefEntry = zip.getEntry('Resources/Preferences.xml');
  const stylesEntry = zip.getEntry('Resources/Styles.xml');
  const graphicEntry = zip.getEntry('Resources/Graphic.xml');
  if (!prefEntry || !stylesEntry || !graphicEntry) {
    console.error('❌ Missing expected Resources/*.xml entries in IDML');
    process.exit(1);
  }

  const pref = await parser.parseStringPromise(prefEntry.getData().toString('utf8'));
  const styles = await parser.parseStringPromise(stylesEntry.getData().toString('utf8'));
  const graphic = await parser.parseStringPromise(graphicEntry.getData().toString('utf8'));

  const prefRoot = pref['idPkg:Preferences'];
  const docPref = prefRoot.DocumentPreference;
  const marginPref = prefRoot.MarginPreference;
  const gridPref = prefRoot.GridPreference;
  const tfPref = prefRoot.TextFramePreference;

  const pageWidthPt = Number(docPref.PageWidth);
  const pageHeightPt = Number(docPref.PageHeight);
  const facingPages = String(docPref.FacingPages) === 'true';

  // Prefer margins/columns from dominant layout master (body), fallback to document prefs
  const lmLeft = layoutMasterMargins?.left;
  const lmRight = layoutMasterMargins?.right;

  function pickNum(v: any, fallback: number): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  const topPt = pickNum(lmRight?.Top ?? lmLeft?.Top ?? marginPref.Top, Number(marginPref.Top));
  const bottomPt = pickNum(lmRight?.Bottom ?? lmLeft?.Bottom ?? marginPref.Bottom, Number(marginPref.Bottom));

  const leftLeftPt = pickNum(lmLeft?.Left ?? marginPref.Left, Number(marginPref.Left));
  const leftRightPt = pickNum(lmLeft?.Right ?? marginPref.Right, Number(marginPref.Right));
  const rightLeftPt = pickNum(lmRight?.Left ?? marginPref.Left, Number(marginPref.Left));
  const rightRightPt = pickNum(lmRight?.Right ?? marginPref.Right, Number(marginPref.Right));

  const leftColCount = pickNum(lmLeft?.ColumnCount ?? marginPref.ColumnCount, Number(marginPref.ColumnCount));
  const rightColCount = pickNum(lmRight?.ColumnCount ?? marginPref.ColumnCount, Number(marginPref.ColumnCount));
  const leftColGutterPt = pickNum(lmLeft?.ColumnGutter ?? marginPref.ColumnGutter, Number(marginPref.ColumnGutter));
  const rightColGutterPt = pickNum(lmRight?.ColumnGutter ?? marginPref.ColumnGutter, Number(marginPref.ColumnGutter));

  const baselineStartPt = parseNum(gridPref.BaselineStart);
  const baselineDivisionPt = parseNum(gridPref.BaselineDivision);

  const tfColCount = tfPref ? parseNum(tfPref.TextColumnCount) : null;
  const tfColGutterPt = tfPref ? parseNum(tfPref.TextColumnGutter) : null;

  // ---- Swatches (Colors) ----
  const gRoot = graphic['idPkg:Graphic'];
  const swatches: Tokens['swatches'] = [];
  for (const c of asArray<any>(gRoot.Color)) {
    const name = String(c.Name || '').trim();
    if (!name) continue;
    const cvRaw = String(c.ColorValue || '').trim();
    const colorValue = cvRaw
      ? cvRaw
          .split(/\s+/g)
          .map((x: string) => Number(x))
          .filter((n: number) => Number.isFinite(n))
      : null;
    swatches.push({
      name,
      space: c.Space ? String(c.Space) : null,
      model: c.Model ? String(c.Model) : null,
      colorValue,
    });
  }

  // ---- Styles ----
  const sRoot = styles['idPkg:Styles'];

  const pGroup = sRoot.RootParagraphStyleGroup;
  const paragraphStylesRaw = asArray<any>(pGroup.ParagraphStyle);

  // Build map for inheritance resolution
  const byName = new Map<string, any>();
  for (const ps of paragraphStylesRaw) {
    const name = String(ps.Name || '');
    if (name) byName.set(name, ps);
  }

  function basedOnName(ps: any): string | null {
    const props = ps?.Properties || {};
    const raw = nodeText(props.BasedOn);
    if (!raw) return null;
    const rawStr = String(raw);
    // Keep $ID/... intact because style names in IDML use that full form.
    if (rawStr.startsWith('$ID/')) return rawStr;
    const stripped = stripRef(rawStr);
    if (!stripped) return null;
    return stripped;
  }

  type EffectiveParaStyle = {
    name: string;
    basedOn: string | null;
    nextStyle: string | null;
    appliedFont: string | null;
    fontStyle: string | null;
    pointSizePt: number | null;
    leadingPt: number | null;
    spaceBeforePt: number | null;
    spaceAfterPt: number | null;
    leftIndentPt: number | null;
    rightIndentPt: number | null;
    firstLineIndentPt: number | null;
    justification: string | null;
    hyphenation: boolean | null;
    hyphenationZonePt: number | null;
    fillColorRef: string | null;
    bulletsAndNumberingListType: string | null;
    bulletCharCode: number | null;
  };

  function resolveEffectiveParagraphStyle(name: string, depth = 0): EffectiveParaStyle | null {
    if (depth > 50) return null;
    const ps = byName.get(name);
    if (!ps) return null;

    const parentName = basedOnName(ps);
    const parent = parentName ? resolveEffectiveParagraphStyle(parentName, depth + 1) : null;

    const props = ps.Properties || {};

    const numOrNull = (v: any): number | null => {
      const n = parseNum(v);
      return typeof n === 'number' && Number.isFinite(n) ? n : null;
    };

    // direct values
    const pointSizePt = numOrNull(ps.PointSize) ?? numOrNull(props.PointSize);
    const leadingPt = numOrNull(props.Leading) ?? numOrNull(ps.Leading);
    const autoLeadingPct = numOrNull(ps.AutoLeading);
    const computedLeadingPt =
      leadingPt !== null
        ? leadingPt
        : pointSizePt !== null && autoLeadingPct !== null
          ? (pointSizePt * autoLeadingPct) / 100
          : null;

    const appliedFont = nodeText(props.AppliedFont);
    const fillColorRef = ps.FillColor ? String(ps.FillColor) : nodeText(props.FillColor);

    const justification = ps.Justification ? String(ps.Justification) : null;
    const hyphenation = ps.Hyphenation !== undefined ? String(ps.Hyphenation) === 'true' : null;
    const hyphenationZonePt = numOrNull(ps.HyphenationZone);

    const bulletsAndNumberingListType = ps.BulletsAndNumberingListType ? String(ps.BulletsAndNumberingListType) : null;
    const bulletChar = props.BulletChar || null;
    const bulletCharCodeRaw = bulletChar && bulletChar.BulletCharacterValue ? numOrNull(bulletChar.BulletCharacterValue) : null;

    const eff: EffectiveParaStyle = {
      name,
      basedOn: parentName,
      nextStyle: ps.NextStyle ? stripRef(String(ps.NextStyle)) : null,
      appliedFont: appliedFont ? String(appliedFont) : parent?.appliedFont ?? null,
      fontStyle: ps.FontStyle ? String(ps.FontStyle) : parent?.fontStyle ?? null,
      pointSizePt: pointSizePt ?? parent?.pointSizePt ?? null,
      leadingPt: computedLeadingPt ?? parent?.leadingPt ?? null,
      spaceBeforePt: numOrNull(ps.SpaceBefore) ?? parent?.spaceBeforePt ?? null,
      spaceAfterPt: numOrNull(ps.SpaceAfter) ?? parent?.spaceAfterPt ?? null,
      leftIndentPt: numOrNull(ps.LeftIndent) ?? parent?.leftIndentPt ?? null,
      rightIndentPt: numOrNull(ps.RightIndent) ?? parent?.rightIndentPt ?? null,
      firstLineIndentPt: numOrNull(ps.FirstLineIndent) ?? parent?.firstLineIndentPt ?? null,
      justification: justification ?? parent?.justification ?? null,
      hyphenation: hyphenation ?? parent?.hyphenation ?? null,
      hyphenationZonePt: hyphenationZonePt ?? parent?.hyphenationZonePt ?? null,
      fillColorRef: fillColorRef ? String(fillColorRef) : parent?.fillColorRef ?? null,
      bulletsAndNumberingListType: bulletsAndNumberingListType ?? parent?.bulletsAndNumberingListType ?? null,
      bulletCharCode: bulletCharCodeRaw ?? parent?.bulletCharCode ?? null,
    };

    return eff;
  }

  const paragraphStyles: Tokens['paragraphStyles'] = paragraphStylesRaw
    .filter((ps) => ps && String(ps.Name || '').trim() && String(ps.Name || '') !== '$ID/[No paragraph style]')
    .map((ps) => {
      const name = String(ps.Name || '').trim();
      const eff = resolveEffectiveParagraphStyle(name);
      if (!eff) {
        return {
          name,
          path: name,
          basedOn: null,
          nextStyle: null,
          appliedFont: null,
          pointSize: null,
          leading: null,
          fillColor: null,
          justification: null,
          hyphenation: null,
        };
      }

      return {
        name,
        path: name,
        basedOn: eff.basedOn,
        nextStyle: eff.nextStyle,
        appliedFont: eff.appliedFont ? { family: eff.appliedFont, style: eff.fontStyle || undefined } : null,
        pointSize: eff.pointSizePt,
        leading: eff.leadingPt,
        fillColor: eff.fillColorRef ? stripRef(String(eff.fillColorRef)) : null,
        justification: eff.justification,
        hyphenation: eff.hyphenation,
        // extra style metrics for token-driven layout
        spaceBeforePt: eff.spaceBeforePt,
        spaceAfterPt: eff.spaceAfterPt,
        leftIndentPt: eff.leftIndentPt,
        rightIndentPt: eff.rightIndentPt,
        firstLineIndentPt: eff.firstLineIndentPt,
        hyphenationZonePt: eff.hyphenationZonePt,
        bulletsAndNumberingListType: eff.bulletsAndNumberingListType,
        bulletCharCode: eff.bulletCharCode,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'nl'));

  // Character styles (optional; not used by CSS generator today)
  const cGroup = sRoot.RootCharacterStyleGroup;
  const characterStylesRaw = asArray<any>(cGroup.CharacterStyle);

  const charByName = new Map<string, any>();
  for (const cs of characterStylesRaw) {
    const name = String(cs.Name || '');
    if (name) charByName.set(name, cs);
  }

  function resolveCharacterStyle(name: string, field: 'pointSize' | 'appliedFont' | 'fillColor', depth = 0): any {
    if (depth > 25) return null;
    const cs = charByName.get(name);
    if (!cs) return null;
    const props = cs.Properties || {};
    const basedOn = nodeText(props.BasedOn);

    const direct = (() => {
      if (field === 'pointSize') return parseNum(cs.PointSize) ?? parseNum(props.PointSize);
      if (field === 'appliedFont') return nodeText(props.AppliedFont);
      if (field === 'fillColor') return (cs.FillColor ? String(cs.FillColor) : null) || nodeText(props.FillColor);
      return null;
    })();

    if (direct !== null && direct !== undefined && direct !== '') return direct;
    if (!basedOn) return null;
    return resolveCharacterStyle(String(basedOn), field, depth + 1);
  }

  const characterStyles: Tokens['characterStyles'] = characterStylesRaw
    .filter((cs) => cs && String(cs.Name || '').trim() && String(cs.Name || '') !== '$ID/[No character style]')
    .map((cs) => {
      const name = String(cs.Name || '').trim();
      const props = cs.Properties || {};
      const basedOn = nodeText(props.BasedOn);

      const appliedFont = resolveCharacterStyle(name, 'appliedFont');
      const pointSize = resolveCharacterStyle(name, 'pointSize');
      const fillColorRef = resolveCharacterStyle(name, 'fillColor');

      return {
        name,
        path: name,
        basedOn: basedOn ? String(basedOn) : null,
        appliedFont: appliedFont ? { family: String(appliedFont), style: cs.FontStyle ? String(cs.FontStyle) : undefined } : null,
        pointSize: pointSize !== null && pointSize !== undefined ? Number(pointSize) : null,
        fillColor: fillColorRef ? stripRef(String(fillColorRef)) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'nl'));

  // Object styles (optional; not used by CSS generator today)
  const oGroup = sRoot.RootObjectStyleGroup;
  const objectStylesRaw = asArray<any>(oGroup.ObjectStyle);

  const objectStyles: Tokens['objectStyles'] = objectStylesRaw
    .filter((os) => os && String(os.Name || '').trim() && String(os.Name || '') !== '$ID/[None]')
    .map((os) => {
      const props = os.Properties || {};
      return {
        name: String(os.Name || '').trim(),
        path: String(os.Name || '').trim(),
        basedOn: nodeText(props.BasedOn) ? String(nodeText(props.BasedOn)) : null,
        fillColor: os.FillColor ? stripRef(String(os.FillColor)) : null,
        strokeColor: os.StrokeColor ? stripRef(String(os.StrokeColor)) : null,
        strokeWeight: os.StrokeWeight !== undefined ? Number(os.StrokeWeight) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'nl'));

  const tokens: Tokens = {
    meta: {
      exportedAt: isoStamp(),
      source: 'idml',
      idmlPath,
      ...(chapterNumber ? { chapterNumber } : {}),
      ...(layoutMasterSelf ? { layoutMasterSelf } : {}),
      ...(layoutMasterName ? { layoutMasterName } : {}),
    },
    page: {
      widthPt: pageWidthPt,
      heightPt: pageHeightPt,
      widthMm: ptToMm(pageWidthPt),
      heightMm: ptToMm(pageHeightPt),
      facingPages,
    },
    marginsAndColumns: {
      // IDML Preferences.xml doesn't differentiate left/right margin guides for facing pages.
      // We mirror the same values into both, and allow the InDesign script to override later.
      left: {
        topMm: ptToMm(topPt),
        bottomMm: ptToMm(bottomPt),
        leftMm: ptToMm(leftLeftPt),
        rightMm: ptToMm(leftRightPt),
        columnCount: leftColCount,
        columnGutterMm: ptToMm(leftColGutterPt),
      },
      right: {
        topMm: ptToMm(topPt),
        bottomMm: ptToMm(bottomPt),
        leftMm: ptToMm(rightLeftPt),
        rightMm: ptToMm(rightRightPt),
        columnCount: rightColCount,
        columnGutterMm: ptToMm(rightColGutterPt),
      },
    },
    baselineGrid: {
      baselineStartMm: typeof baselineStartPt === 'number' ? ptToMm(baselineStartPt) : null,
      baselineDivisionMm: typeof baselineDivisionPt === 'number' ? ptToMm(baselineDivisionPt) : null,
    },
    textFrames: {
      representative: {
        textColumnCount: typeof tfColCount === 'number' ? tfColCount : null,
        textColumnGutterMm: typeof tfColGutterPt === 'number' ? ptToMm(tfColGutterPt) : null,
      },
    },
    paragraphStyles,
    characterStyles,
    objectStyles,
    swatches: swatches.sort((a, b) => a.name.localeCompare(b.name, 'nl')),
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(tokens, null, 2), 'utf8');

  console.log(`✅ Wrote IDML design tokens: ${outPath}`);
  console.log(`   IDML: ${idmlPath}`);
  console.log(`   Paragraph styles: ${paragraphStyles.length}`);
  console.log(`   Swatches: ${tokens.swatches.length}`);
}

main().catch((e) => {
  console.error('❌ Failed extracting IDML design tokens:', e);
  process.exit(1);
});


