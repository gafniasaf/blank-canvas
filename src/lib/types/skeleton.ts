export interface Skeleton {
  metadata: {
    source_idml: string; // Path to N4 source for versioning
    title?: string; // Book title for context
    chapter_id: string;
    version: "1.0";
  };
  sections: Array<{
    id: string; // e.g., "1.1"
    title: string;
    subsections: Array<{
      id: string; // e.g., "1.1.1"
      title: string;
      // The linear sequence of logical units to be written
      units: GenerationUnit[];
    }>;
  }>;
}

/**
 * Unit types in the skeleton:
 * - `prose`: Normal paragraph rewrite from extracted facts.
 * - `composite_list`: Intro + list items merged; rewritten as one coherent block (prose or semicolon list).
 * - `box_verdieping`: Deepening box derived from source technical depth (rewrite in N3 style, keep N4 complexity).
 * - `box_praktijk`: Practice box. Can be:
 *   - generated as NEW content when `content.facts` contains `GENERATE_PRAKTIJK`
 *   - or rewritten from existing practice-like source content.
 */
export type UnitType = "prose" | "composite_list" | "box_praktijk" | "box_verdieping";

/**
 * A "Unit" is what the LLM sees and writes.
 * It may contain multiple canonical blocks (e.g., list intro + list items).
 */
export interface GenerationUnit {
  id: string; // UUID for the unit
  type: UnitType;

  // Traceability to N4 backbone (REQUIRED for numbering validation)
  n4_mapping: Array<{
    original_id: string; // e.g., "p105"
    role: "intro" | "item" | "body" | "heading";
    subparagraph_index: number; // Preserves 1.1.1.X order
  }>;

  // Content for the LLM
  content: {
    facts: string[]; // Extracted facts
    micro_heading?: string; // e.g., "Eiwitten:" (extracted from bold start)
  };

  /**
   * Placement rules:
   * - `flow`: normal in-flow unit (maps to canonical blocks via n4_mapping)
   * - `after_block`: box unit attaches to a host canonical block (preferred, explicit)
   * - `after_unit`: legacy alias used by older skeletons (use host_* instead)
   */
  placement: {
    anchor_type: "flow" | "after_unit" | "after_block";
    /**
     * Back-compat (older skeletons): unit ID the box follows.
     * Prefer host_unit_id / host_block_id.
     */
    anchor_id?: string;
    /**
     * Explicit box anchoring: which unit/block this box attaches to.
     * host_block_id is a canonical JSON block id (preferred).
     */
    host_unit_id?: string;
    host_block_id?: string;
  };
}

