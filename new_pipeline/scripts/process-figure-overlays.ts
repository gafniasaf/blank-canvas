import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const OVERLAYS_JSON_PATH = process.argv[2];
const OUTPUT_DIR = path.resolve('new_pipeline/assets/figures_highres');
const OUTPUT_MAP_PATH = path.resolve('new_pipeline/generated/figure_overlays_map.json');
const NUMBER_MAP_PATH = path.resolve('new_pipeline/generated/figure_number_map.json');

if (!OVERLAYS_JSON_PATH || !fs.existsSync(OVERLAYS_JSON_PATH)) {
  console.error('Usage: tsx scripts/process-figure-overlays.ts <path_to_overlays_json>');
  process.exit(1);
}

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Ensure generated dir exists
const generatedDir = path.dirname(OUTPUT_MAP_PATH);
if (!fs.existsSync(generatedDir)) {
  fs.mkdirSync(generatedDir, { recursive: true });
}

const rawData = fs.readFileSync(OVERLAYS_JSON_PATH, 'utf-8');
const data = JSON.parse(rawData);

const processedFigures: Record<string, any> = {};
const figureNumberMap: Record<string, string> = {}; // "1.2" -> "MAF_Ch01_Img2.TIF"

console.log(`Processing ${data.figures.length} figures...`);

for (const fig of data.figures) {
  const originalPath = fig.linkPath;
  const originalName = fig.image;
  
  // Try to find Figure Number in captions (style: _Annotation)
  // Format: "Afbeelding 1.2 Anatomie van..."
  const captionOverlay = fig.overlays.find((o: any) => o.style === '_Annotation');
  if (captionOverlay) {
    const text = captionOverlay.content.trim();
    // Regex to match "Afbeelding X.Y" or "Figuur X.Y"
    const match = text.match(/(?:Afbeelding|Figuur)\s+(\d+(?:\.\d+)+)/i);
    if (match) {
        const figNum = match[1];
        figureNumberMap[figNum] = originalName;
    }
  }

  // Normalize filename for web (remove spaces, parens)
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const baseName = path.parse(safeName).name;
  
  // Convert/Copy image
  const destPng = path.join(OUTPUT_DIR, `${baseName}.png`);
  
  // If original is TIF/PSD/AI/EPS, convert to PNG using sips
  // If JPG/PNG, just copy (or convert to PNG to be safe and consistent)
  
  try {
    if (fs.existsSync(destPng)) {
       // Skip if already exists to save time? Or overwrite?
       // Let's overwrite to be safe.
    }
    
    if (fs.existsSync(originalPath)) {
      // Use sips to convert to PNG
      // -s format png
      // --resampleWidth 2000 (optional, limit max width?) -> NO, keep max res
      // No downsampling!
      execSync(`sips -s format png "${originalPath}" --out "${destPng}"`, { stdio: 'ignore' });
      // console.log(`Processed: ${originalName} -> ${baseName}.png`);
    } else {
      console.warn(`Warning: Source image not found: ${originalPath}`);
      continue;
    }
  } catch (e) {
    console.error(`Error processing ${originalName}:`, e);
    continue;
  }

  // Filter overlays
  const validOverlays = fig.overlays.filter((o: any) => {
    // Keep only Label styles
    const style = o.style || '';
    
    // Explicit exclusions (Caption, Body Text)
    if (style === 'Bijschrift' || style === '_Annotation') return false; 
    if (style.startsWith('•') || style.startsWith('_')) return false; 
    if (style.includes('Header') || style.includes('Bullets')) return false;
    
    // Inclusions
    if (style.startsWith('Labels')) return true;
    if (style.includes('FreightSans')) return true; // Label font
    
    // [Basic Paragraph] and [No Paragraph Style] - check length/content
    if (style.startsWith('[') && style.endsWith(']')) {
        // likely "[Basic Paragraph]" or "[No Paragraph Style]"
        // Heuristic: Short text, no bullets, usually single line
        if (o.content.length < 50 && !o.content.trim().startsWith('•') && !o.content.includes('\n\n')) {
            return true;
        }
    }
    
    // Fallback: if style is "Unknown" (from script fallback), check content length
    if (style === 'Unknown' && o.content.length < 50) return true;
    
    return false; 
  });

  // Store in map
  // Key is the ORIGINAL filename (as extracted from canonical JSON usually references this)
  // Wait, canonical JSON usually references the filename stored in DB or extracted.
  // We need to match what the renderer expects. 
  // The renderer sees "MAF_Ch1_Img01.tif" or similar.
  // We'll use the original filename as key.
  
  if (validOverlays.length > 0) {
    processedFigures[originalName] = {
      src: `assets/figures_highres/${baseName}.png`, // Relative to build root
      width_mm: fig.dimensions.width,
      height_mm: fig.dimensions.height,
      overlays: validOverlays.map((o: any) => ({
        content: o.content,
        left_mm: o.relX,
        top_mm: o.relY,
        width_mm: o.width,
        height_mm: o.height,
        style: o.style
      }))
    };
  } else {
    // Even if no overlays, we might want to use the high-res image!
    // But only if we are replacing ALL images.
    // Yes, let's provide the map even if no overlays, so we use the high-res version.
    processedFigures[originalName] = {
      src: `assets/figures_highres/${baseName}.png`,
      width_mm: fig.dimensions.width,
      height_mm: fig.dimensions.height,
      overlays: []
    };
  }
}

fs.writeFileSync(OUTPUT_MAP_PATH, JSON.stringify(processedFigures, null, 2));
fs.writeFileSync(NUMBER_MAP_PATH, JSON.stringify(figureNumberMap, null, 2));
console.log(`\nDone! Map saved to ${OUTPUT_MAP_PATH}`);
console.log(`Figure number map saved to ${NUMBER_MAP_PATH}`);
console.log(`Processed ${Object.keys(processedFigures).length} figures.`);
console.log(`Found ${Object.keys(figureNumberMap).length} figure numbers.`);

