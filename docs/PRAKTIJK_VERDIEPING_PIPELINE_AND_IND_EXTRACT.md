## Praktijk/Verdieping: schrijfbeslissingen + pipeline-overzicht + InDesign extractie (één document)

**Doel van dit document**  
Dit is de “single doc” uitleg voor (AI) agents die in deze repo werken: hoe we bepalen **wat** er in **“In de praktijk”** komt, hoe **Verdieping** wordt gekozen, hoe **canonical → skeleton → (rewrites) → assembled/full JSON** wordt gebouwd, en hoe we **tekst, beelden en stijlen** uit InDesign/IDML halen.

**Scope**  
- Student output is **Prince-first** (via `new_pipeline/`) en moet **KD-vrij** blijven (geen codes/tags/“KD” in studenttekst).  
- `--mode indesign` en de InDesign-apply flow bestaan nog als legacy/deterministische apply-optie.

---

## 1) Begrippen (data-producten)

### 1.1 Canonical JSON (Prince canonical)
**Wat:** de “structuur-truth” van een boek/hoofdstuk: chapters → sections → blocks (`paragraph`/`list`/`steps`/`subparagraph`), met IDs die deterministisch matchen met DB/IDML.  
**Waar:** gegenereerd door `new_pipeline/export/export-canonical-from-db.ts` naar `new_pipeline/output/*.json`.  
**Waarom:** dit is de basis voor Prince rendering (structuur + figuren + styling roles).

### 1.2 Skeleton JSON (skeleton-first)
**Wat:** een **generatieplan** bovenop canonical: een lijst “units” met:
- `type` (prose, composite_list, box_praktijk, box_verdieping, …)
- `content.facts` (input-facts uit canonical)
- `n4_mapping` (welke canonical block IDs erbij horen)
- `placement` (waar een box moet “hangen” / host-block)

**Waar:** `new_pipeline/scripts/extract-skeleton.ts` → `new_pipeline/output/skeleton_ch<N>.json`.

### 1.3 Rewrites JSON (twee varianten)
Er zijn twee dominante vormen in deze repo:

- **Skeleton rewrites** (skeleton-first):  
  `new_pipeline/scripts/generate-from-skeleton.ts` schrijft een bestand met o.a. `rewritten_units: { unit_id -> text }`.

- **Rewrites-for-InDesign / JSON-first** (paragraph-first):  
  `scripts/build-book-json-first.ts` / `scripts/llm-iterate-rewrites-json.ts` werken op:
  `{ paragraphs: [ { paragraph_id, chapter, paragraph_number, subparagraph_number, original, rewritten, style_name, ... } ] }`  
  Deze JSON is apply-safe (legacy) én bruikbaar als input voor de Prince overlay.

### 1.4 Assembled / Full JSON (render-ready)
**Wat:** canonical JSON + tekst-updates + boxes/labels correct geplaatst.  
**Waar:**
- Skeleton-first assembly: `new_pipeline/scripts/assemble-skeleton-rewrites.ts` → `*.assembled.json`
- JSON-first overlay: `new_pipeline/export/apply-rewrites-overlay.ts` → `*.rewritten.json` (of vergelijkbaar)

### 1.5 “Section” en numbering: wat bedoelen we precies?
In deze repo zijn “sections” en “keys” heel concreet:

- **Chapter**: `chapter_number` (tekst, bv. `"1"`)
- **Paragraph**: `paragraph_number` (integer, bv. `2` in `1.2`)
- **Subparagraph**: `subparagraph_number` (integer of `null`, bv. `3` in `1.2.3`)

Waar je dit ziet:
- In **rewrites JSON**: velden `chapter`, `paragraph_number`, `subparagraph_number` (die laatste **moet bestaan**, ook als `null`).
- In **canonical JSON**: `chapter.number` en `section.number` (bv. `"1.2"`), en subparagraaf blocks met `number`/`title` afhankelijk van bron.
- In **skeleton JSON**: `section.id` is meestal gelijk aan `section.number` uit canonical; `subsection.id` is bv. `"1.2.3"` of een synthetic id zoals `"1.2.root"` (introductie-content buiten subparagrafen).

---

## 2) “In de praktijk”: hoe bepalen we wat we schrijven?

### 2.1 Wat is “In de praktijk” inhoudelijk?
Een **korte, realistische praktijk-situatie** voor MBO niveau 3 (NL), in **je-vorm**: wat je in je werk ziet/doet/controleert/uitlegt bij een **zorgvrager**, gekoppeld aan de leerstof van die (sub)paragraaf.

**Belangrijk:** “In de praktijk” is **meestal nieuw gegenereerde tekst** (niet knippen/plakken uit de basis), tenzij het al expliciet als praktijkbox in de bron aanwezig is.

### 2.2 Relevantie-beslissing: GENERATE vs SKIP
Onze generator laat de LLM eerst beslissen of een praktijkbox zinvol is.

In de skeleton-first generator staat dit expliciet:
- `new_pipeline/scripts/generate-from-skeleton.ts`: bij `unit.type === 'box_praktijk'` kan het model exact `SKIP` teruggeven als er **geen zinnige koppeling** bestaat.

**Praktisch criterium (mentaal model):**
- **GENERATE** als je de theorie kunt vertalen naar een actie/observatie/keuze die in de zorgpraktijk echt voorkomt (met effect op veiligheid, comfort, therapietrouw, uitleg, signaleren).
- **SKIP** als de theorie te abstract is of alleen “biologie/chemie mechaniek” zonder praktische handeling of betekenis voor zorgsituaties.

### 2.3 Schrijfregels (in output)
In de Prince pipeline en ook in JSON-first gelden steeds dezelfde student-facing regels:
- **Perspectief:** schrijf in “je”.
- **Terminologie:** altijd **zorgvrager** en **zorgprofessional** (nooit cliënt/client/patiënt/verpleegkundige).
- **Lengte:** houd het compact; in de praktijk houden we het **ca. 4–7 zinnen**, 1 alinea (skeleton-first editorial pass enforce’t dit).
- **Niet te technisch:** leg alleen uit wat voor de zorgvrager relevant is. Als iets te technisch is: gebruik het als “jouw begrip” → vertaal naar een praktische actie (“Je weet dat … daarom let je op …”).

### 2.4 Anti-boilerplate (variatie en nuttigheid)
We sturen actief op variatie en vermijden administratieve clichés:

- In `new_pipeline/scripts/generate-from-skeleton.ts` zit een **editorial pass** (`llmEditorialPassPraktijk`) die:
  - repetitie over meerdere praktijkboxen in dezelfde sectie vermindert,
  - standaardafsluiters zoals “noteer in het dossier” / “bespreek met je team” verwijdert tenzij echt essentieel,
  - voorkomt dat veel boxen starten met dezelfde opener (“Je helpt een zorgvrager met …”).

**Concreet (do):**
- Begin met een **moment/actie**: observeer, begeleid, meet, leg uit, controleer, signaleer, ondersteun.
- Koppel aan 1–2 kernbegrippen uit de subparagraaf.

**Concreet (don’t):**
- Geen “admin-eindjes” als standaard slot.
- Geen generieke vraag-zinnen die overal passen (“je vraagt hoe de zorgvrager zich voelt”) als template.
- Geen extra labels (“In de praktijk:”) in de tekst: layout doet dit.

### 2.5 Outputformat (labels / markers)
Er zijn twee representaties:

- **Prince / canonical velden**: praktijktekst leeft als `block.praktijk` (geen label in tekst).
- **Legacy InDesign apply JSON**: de labelregel wordt **samengesteld** (Option A) en in `rewritten` gezet:
  - `<<BOLD_START>>In de praktijk:<<BOLD_END>> <inline tekst>`

De combiner/validator voor die Option-A regels is:
- `src/lib/indesign/rewritesForIndesign.ts`:
  - `buildCombinedBasisPraktijkVerdieping()`
  - `validateCombinedRewriteText()`
  - `ensureLowercaseAfterColon()`

### 2.6 Plaatsingsregel (belangrijk bij opsommingen/bullets)
**Waarom dit bestaat:** het grootste “drift/plaatsings”-risico is een **list-intro** (eindigt op `:`) gevolgd door bullets. Als je daar praktijk/verdieping in dezelfde paragraaf plakt, komt de box **tussen intro en bullets** te staan.

Regel (non-negotiable; enforced door preflight/fixers):
- Plaats praktijk/verdieping **nooit** in een list-intro paragraaf die gevolgd wordt door bullets.
- Preferred host is: **laatste veilige body-paragraaf na de bullet-run**.

Waar dit afgedwongen wordt:
- Deterministische fixer: `src/lib/indesign/rewritesForIndesignFixes.ts`
- JSON lint gate: `src/lib/indesign/rewritesForIndesignJsonLint.ts` (via `npm run preflight:json`)

---

## 3) “Verdieping”: hoe bepalen we wat erin komt?

### 3.1 Wat is “Verdieping” inhoudelijk?
Verdieping is **didactische bundeling van bestaande complexe stof**: mechanisme, formule, meerstapsproces, technische verdieping.

**Belangrijk design-besluit:** Verdieping is **geen nieuw gegenereerde tekst** in onze skeleton-first flow; we **selecteren** bestaande content en renderen die als box.

Dat staat letterlijk in de pass2 script header:
- `new_pipeline/scripts/pass2-verdieping-microheadings.ts`: “Verdieping boxes use EXISTING content - no generation needed”.

### 3.2 Selectie-regels (skeleton-first pass2)
`new_pipeline/scripts/pass2-verdieping-microheadings.ts` plant per section:
- microheadings (~30–40% van above-average blocks)
- verdieping candidates: **≥65 woorden** (proxy voor “complex genoeg”)
- kiest 1–2 units per section, spreidt ze (niet adjacent).

### 3.3 Output/representatie
In skeleton-first assembly kunnen verdieping-teksten op twee manieren terechtkomen:
- als **box unit** (`box_verdieping`) die aan een host block hangt, of
- via markers zoals `<<VERDIEPING_BOX>>...<<VERDIEPING_BOX_END>>` die de assembler in `block.verdieping` “uitknipt”.

De assembler die dit doet:
- `new_pipeline/scripts/assemble-skeleton-rewrites.ts`
  - zet `primaryBlock.verdieping = ...`
  - demote’t lege list/steps blocks naar `paragraph` zodat de renderer geen “lege lijst” rendert
  - als content “verplaatst” wordt naar een box: originele blocks worden `merged=true` en leeggemaakt (zodat het niet dubbel verschijnt).

---

## 4) Pipeline-overzicht (wat draaien we vandaag?)

### 4.1 Prince-first (default) — build-chapter
Standaard entrypoint:
- `new_pipeline/scripts/build-chapter.ts` (aangeroepen via `cd new_pipeline && npm run build:chapter -- ...`)

Wat het doet (high-level):
1. **Design tokens** uit canonical IDML snapshot → CSS tokens:
   - `new_pipeline/extract/parse-idml-design-tokens.ts`
   - `new_pipeline/templates/generate-prince-css-from-tokens.ts`
   - `new_pipeline/validate/verify-design-tokens.ts`
2. **Canonical JSON**:
   - export uit DB: `new_pipeline/export/export-canonical-from-db.ts <uploadId> --chapter <N>`
   - optioneel figuren injecteren via `--figures ...`
3. **Validaties** (optioneel vs DB) + figuren checks
4. **Optioneel: skeleton-first rewrite-mode** (`--rewrite-mode skeleton`):
   - `new_pipeline/scripts/extract-skeleton.ts`
   - `scripts/validate-skeleton.ts` (repo root; warnings toegestaan)
   - `new_pipeline/scripts/generate-from-skeleton.ts`
   - `new_pipeline/scripts/assemble-skeleton-rewrites.ts`
5. **Optioneel: overlay JSON-first rewrites** (`--rewrites ...`):
   - `new_pipeline/export/apply-rewrites-overlay.ts`
6. **Render**:
   - `new_pipeline/renderer/render-prince-pdf.ts` (HTML→Prince PDF)
7. **Prince layout validation suite** (in `new_pipeline/validate/*`).

### 4.2 Prince-first (default) — build-book
Whole-book entrypoint:
- `new_pipeline/scripts/build-book.ts` (`cd new_pipeline && npm run build:book -- ...`)

Dit bouwt multi-chapter output + draait dezelfde render/validatie suite op het nieuwste PDF-resultaat.

### 4.3 JSON-first rewrite pipeline (repo root)
Dit is de “flat paragraphs” pipeline die ook InDesign-apply mogelijk houdt:
- Deterministische fix: `scripts/fix-rewrites-json-for-indesign.ts` (via `npm run fix:json`)
- Preflight gates: `scripts/preflight-rewrites-json.ts` (via `npm run preflight:json`)
- Iteratieve LLM loop: `scripts/llm-iterate-rewrites-json.ts` (via `npm run iterate:json`)
- Review pass: `scripts/llm-review-rewrites-json.ts` (via `npm run review:json`)
- Promote: `scripts/promote-rewrites-for-indesign.ts` (via `npm run promote:json`)

**Belangrijk onderscheid:** deze pipeline schrijft doorgaans `rewritten` tekst per paragraaf (met Option-A headings), terwijl de Prince canonical pipeline liever `basis/praktijk/verdieping` velden gebruikt.

---

## 5) Canonical → Skeleton → Full JSON (detail)

### 5.1 Canonical export uit DB
Script:
- `new_pipeline/export/export-canonical-from-db.ts`

Belangrijke details:
- haalt paragraphs uit Postgres (upload_id + chapter) en bouwt een renderer-agnostisch schema (`new_pipeline/schema/canonical-schema.ts`).
- clean’t tekst:
  - verwijdert soft hyphens (U+00AD)
  - normaliseert line breaks (geen `\r`)
  - verwijdert bold markers voor “plain” velden, maar bewaart rich markers voor render content waar nodig
- gebruikt `new_pipeline/schema/style-role-map.json` om `role` te infereren (stable rendering hook).
- heeft een “IDML inline bold extraction” pad om bold segments uit IDML stories te halen voor Prince-parity.

### 5.2 Skeleton extractie
Script:
- `new_pipeline/scripts/extract-skeleton.ts`

Wat het doet:
- loopt door canonical blocks en produceert `GenerationUnit`s.
- classificeert block types o.a. op `block.styleHint`/`block.role`:
  - bestaande “praktijk/verdieping” in de bron → `box_praktijk` / `box_verdieping`
  - list/steps → `composite_list`
  - prose → `prose`
- merge’t “intro:” + list samen tot één `composite_list` unit als dat nodig is om flow te behouden.

### 5.3 Tekstgeneratie uit skeleton
Script:
- `new_pipeline/scripts/generate-from-skeleton.ts`

Wat het doet:
- gebruikt een MBO N3 stijl prompt, bewaakt marker-hygiëne (alleen toegestane markers).
- **Praktijkboxes**:
  - kan nieuw genereren (of bestaande herschrijven)
  - mag `SKIP` retourneren wanneer irrelevante koppeling
  - draait daarna een **section-level editorial pass** om repetitie te reduceren (alle praktijkboxes in die section als set).
- **Verdieping**:
  - wordt niet “nieuw bedacht” in pass2; in pass1 kan het als box-unit bestaan wanneer de bron het al heeft.
- **Microheadings**:
  - alleen als ze expliciet gepland zijn: output gebruikt `<<MICRO_TITLE>>...<<MICRO_TITLE_END>>` (en anders niet).

### 5.4 Assembler: canonical updaten + boxes plaatsen
Script:
- `new_pipeline/scripts/assemble-skeleton-rewrites.ts`

Kerngedrag:
- map’t `unit_id → canonical block id` via `n4_mapping`.
- prose/composite_list: zet `block.basis` naar nieuwe tekst; demote’t lege list/steps blocks.
- box units: hangt `block.praktijk` / `block.verdieping` aan een expliciete host block (via `placement.host_block_id` of host_unit_id/anchor_id).
- wanneer box content uit bestaande blocks komt: markeert die blocks `merged=true` en leegt ze om dubbele weergave te voorkomen.

### 5.5 Overlay: JSON-first rewrites op canonical
Script:
- `new_pipeline/export/apply-rewrites-overlay.ts`

Belangrijke details:
- matcht op `paragraph_id` en werkt canonical `basis`/`items` bij.
- kan rewrite-tekst interpreteren als:
  - semicolon-items, newline bullets, inline `•` bullets → converteert naar `items` wanneer passend
- extraheert Option-A praktijk/verdieping markers uit `rewritten`:
  - `<<BOLD_START>>In de praktijk:<<BOLD_END>> ...`
  - `<<BOLD_START>>Verdieping:<<BOLD_END>> ...`
  en schrijft ze naar `block.praktijk` / `block.verdieping` (default: overschrijft bestaande boxes niet tenzij `--overwrite-boxes`).

---

## 6) InDesign/IDML extractie: tekst

### 6.1 Canonical N4 IDML snapshot (numbering backbone)
InDesign script:
- `export-n4-idml-from-downloads.jsx`

Gedrag:
- leest `books/manifest.json`
- opent `book.canonical_n4_indd_path` read-only
- exporteert naar `book.canonical_n4_idml_path` (typisch `_source_exports/...__FROM_DOWNLOADS.idml`)
- sluit zonder save

Waarom:
- deze IDML snapshot is de deterministische bron voor de numbering/backbone gate:
  - `python3 scripts/verify-json-numbering-vs-n4.py --json <json> --idml <n4_idml> --require-subfield true`

### 6.2 IDML ingest → Postgres (book_paragraphs)
Script (headless, geen InDesign nodig):
- `new_pipeline/import/ingest-idml-multi-local-pg.ts`

Belangrijke details:
- verwerkt 1+ IDML’s als “één upload” (één `book_uploads` row; één upload_id).
- kiest “main stories” door story grootte te ranken (vermijdt ruis).
- detecteert headings via styleName heuristieken (`isHeaderStyle`) en parse’t numbering uit tekst (`extractParagraphNumber`).
- schrijft content rows met `source_seq` in `formatting_metadata` voor stabiele ordering.

---

## 7) InDesign/IDML extractie: styles (design tokens)

Er zijn twee paden (zelfde output shape):

### 7.1 Direct uit InDesign (ExtendScript)
Script:
- `export-design-tokens.jsx`

Output:
- `new_pipeline/extract/design_tokens.json`

Bevat o.a.:
- paginaformaat, margins/columns, baseline grid
- paragraph/character/object styles (font, size, leading, justification, hyphenation, indents, …)
- swatches/kleuren

### 7.2 Headless uit IDML (deterministisch)
Script:
- `new_pipeline/extract/parse-idml-design-tokens.ts <idml> --out new_pipeline/extract/design_tokens.json`

Wordt standaard gedraaid door `new_pipeline/scripts/build-chapter.ts`.

### 7.3 Tokens → Prince CSS
Script:
- `new_pipeline/templates/generate-prince-css-from-tokens.ts`

Schrijft:
- `new_pipeline/templates/prince-af-two-column.tokens.css`

---

## 8) InDesign extractie: images/figuren

### 8.1 Prince “atomic figures” (per hoofdstuk)
De Prince pipeline werkt idealiter met “atomic exports” (figuur + label/callouts correct).

Belangrijke scripts:
- InDesign: `export-figure-manifest.jsx`  
  Schrijft o.a.: `new_pipeline/extract/figure_manifest_ch<N>.json` + assets.
- Linked images (niet-atomic) kopiëren: `new_pipeline/extract/copy-ch<N>-images.ts` (bv. `copy-ch1-images.ts`)
- Figures → paragraph_id mapping:
  - `new_pipeline/extract/map-figures-to-paragraphs.ts <uploadId> --chapter <N>`
  - merge: `new_pipeline/extract/merge-figures-by-paragraph.ts --chapters ... --out extract/figures_by_paragraph_all.json`

### 8.2 High-res “labels embedded” extract voor ALLE boeken (full-page export + smart crop)
Dit is de robuste, multi-book batch pipeline die we gebruikt hebben om **hoge resolutie figuren met labels** te krijgen zonder fragiele InDesign grouping/duplicate hacks.

Orchestrator:
- `run-all-books-highres.py`

Per INDD:
1. InDesign metadata (figure bounds in page-units + needed pages):
   - `export-metadata-from-config.jsx` schrijft `figure_metadata.json` + `needed_pages.txt`
2. InDesign export pages @300dpi (alleen needed pages):
   - `export-pages-300-from-config.jsx` schrijft `page_exports_300/page_<name>.jpg`
3. Python smart crop:
   - `smart_crop.py` → `figures_300/*.png`

Output root:
- `~/Desktop/highres_labeled_figures/<book>/<indd_stem>/...`

Packaging + documentatie (dedup + manifests + zip):
- `scripts/build-updated-images-package.py` → `~/Desktop/Updated images/` + `~/Desktop/Updated images.zip`

---

## 9) Validatie-gates (wat moet “groen” zijn)

### 9.1 Numbering/backbone gate (N4 snapshot)
- `python3 scripts/verify-json-numbering-vs-n4.py --json <jsonPath> --idml <n4_idml> --require-subfield true`

### 9.2 JSON structural gate (preflight)
- `npm run preflight:json -- <json>`
  - geen `\r`
  - Option A headings
  - veilige layer placement (geen praktijk/verdieping in list-intro vóór bullets)

### 9.3 Prince layout validation suite
Run in `new_pipeline/` op de nieuwste PDF output:
- `cd new_pipeline && npm run build:chapter ...` of `npm run build:book ...`

---

## 10) Praktische “agent runbook” (kort)

### 10.1 Als je “In de praktijk” inhoud wilt aanpassen (skeleton-first)
- draai skeleton-first rewrite (`new_pipeline/scripts/build-chapter.ts --rewrite-mode skeleton`) voor het hoofdstuk/sectie
- check of praktijkboxes `SKIP` correct zijn (geen irrelevante boxen)
- check variatie (editorial pass) en terminologie (zorgvrager/zorgprofessional)

### 10.2 Als je bestaande rewrites wilt overlayen op canonical (Prince)
- bouw/heb `rewrites_for_indesign.<...>.FINAL.json`
- draai `new_pipeline/export/apply-rewrites-overlay.ts canonical.json rewrites.json --out ...`

### 10.3 Als je een nieuwe book snapshot nodig hebt (numbering gate)
- update `books/manifest.json`
- run in InDesign: `export-n4-idml-from-downloads.jsx`


