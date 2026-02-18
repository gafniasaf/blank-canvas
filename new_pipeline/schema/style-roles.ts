/**
 * Semantic roles for content blocks derived from InDesign paragraph styles.
 *
 * The goal is to avoid rendering logic coupled to raw style names.
 * We keep a deterministic mapping file (`style-role-map.json`) as the
 * primary source of truth, with small heuristic fallbacks.
 */

export type StyleRole =
  | 'body'
  | 'bullet_lvl1'
  | 'bullet_lvl2'
  | 'bullet_lvl3'
  | 'numbered_steps'
  | 'section_header'
  | 'subparagraph_header'
  | 'unknown';

export type StyleRoleMap = Record<string, StyleRole>;

export function inferStyleRole(opts: { styleName?: string | null; map?: StyleRoleMap }): StyleRole | undefined {
  const name = String(opts.styleName || '').trim();
  if (!name) return undefined;

  // Deterministic overrides first
  if (opts.map && Object.prototype.hasOwnProperty.call(opts.map, name)) {
    return opts.map[name];
  }

  const lower = name.toLowerCase();

  // Heuristic fallbacks (only when not mapped)
  if (lower.includes('bullets lvl 2') || lower.includes('bullets lvl2')) return 'bullet_lvl2';
  if (lower.includes('bullets lvl 3') || lower.includes('bullets lvl3')) return 'bullet_lvl3';
  if (lower.includes('bullets')) return 'bullet_lvl1';
  if (lower.includes('numbered')) return 'numbered_steps';
  if (lower.includes('subchapter header') || lower.includes('subparagraph header')) return 'subparagraph_header';
  if (lower.includes('chapter header')) return 'section_header';
  if (name === '•Basis' || lower.includes('basis')) return 'body';

  return 'unknown';
}
































