import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const JSON_PATH = path.resolve(__dirname, '../new_pipeline/output/af4_merged_bounds.json');
const PDF_PATH = path.resolve(__dirname, '../new_pipeline/output/highres_exports/MBO_AF4_2024_COMMON_CORE_HIGHRES.pdf');
const OUTPUT_DIR = path.resolve(__dirname, '../new_pipeline/output/af4_strict_crops');

const DPI = 300; // High resolution

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

interface Figure {
  image: string;
  pageIndex: number;
  bounds: [number, number, number, number]; // [top, left, bottom, right] in POINTS
}

function processFigures() {
  if (!fs.existsSync(JSON_PATH)) {
    console.error(`JSON manifest not found: ${JSON_PATH}`);
    return;
  }
  
  const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
  const figures: Figure[] = data.figures;
  
  console.log(`Processing ${figures.length} figures...`);
  
  for (let i = 0; i < figures.length; i++) {
    const fig = figures[i];
    
    // Construct clean filename
    const baseName = path.basename(fig.image, path.extname(fig.image)).replace(/[^a-zA-Z0-9._-]/g, '_');
    let uniqueName = `${baseName}_p${fig.pageIndex}`;
    
    // Handle duplicates
    let counter = 1;
    let outFilePrefix = path.join(OUTPUT_DIR, uniqueName);
    while (fs.existsSync(outFilePrefix + ".png")) {
        uniqueName = `${baseName}_p${fig.pageIndex}_${counter}`;
        outFilePrefix = path.join(OUTPUT_DIR, uniqueName);
        counter++;
    }
    
    // Bounds from InDesign (Points) -> Pixels
    let topPt = fig.bounds[0];
    let leftPt = fig.bounds[1];
    let bottomPt = fig.bounds[2];
    let rightPt = fig.bounds[3];

    // Safety normalization
    if (topPt > bottomPt) [topPt, bottomPt] = [bottomPt, topPt];
    if (leftPt > rightPt) [leftPt, rightPt] = [rightPt, leftPt];
    
    const widthPt = rightPt - leftPt;
    const heightPt = bottomPt - topPt;
    
    // Convert to Pixels
    // 1 pt = 1/72 inch
    const scale = DPI / 72;
    const xPx = Math.round(leftPt * scale);
    const yPx = Math.round(topPt * scale);
    const wPx = Math.round(widthPt * scale);
    const hPx = Math.round(heightPt * scale);
    
    // Note: pdftocairo uses 1-based indexing for -f and -l flags
    // The JSON pageIndex is already 1-based from our InDesign script
    
    // Command flags:
    // -png: Output PNG format
    // -r [DPI]: Resolution
    // -f [N] -l [N]: Page range (single page)
    // -x [pixel_x] -y [pixel_y]: Crop origin (from top-left)
    // -W [pixel_w] -H [pixel_h]: Crop size
    // -singlefile: Prevents appending page number suffix to output filename
    //
    // OMITTING -transp ensures white background (default behavior)
    
    // console.log(`[${i+1}/${figures.length}] Cropping ${uniqueName} (Page ${fig.pageIndex}) - ${wPx}x${hPx}px`);
    
    try {
      if (wPx <= 0 || hPx <= 0) {
        console.error(`Skipping ${uniqueName}: Invalid dimensions ${wPx}x${hPx}`);
        continue;
      }

      const cmd = `pdftocairo -png -r ${DPI} -f ${fig.pageIndex} -l ${fig.pageIndex} -x ${xPx} -y ${yPx} -W ${wPx} -H ${hPx} -singlefile "${PDF_PATH}" "${outFilePrefix}"`;
      execSync(cmd, { stdio: 'ignore' });
    } catch (e) {
      console.error(`Failed to crop ${uniqueName}:`, e);
    }
  }
}

processFigures();
