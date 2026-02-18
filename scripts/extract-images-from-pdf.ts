import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const JSON_PATH = path.resolve(__dirname, '../new_pipeline/output/af4_overlays_points.json');
const PDF_PATH = path.resolve(__dirname, '../new_pipeline/output/highres_exports/MBO_AF4_2024_COMMON_CORE_HIGHRES.pdf');
const OUTPUT_DIR = path.resolve(__dirname, '../new_pipeline/output/af4_highres_figures_from_pdf');

const DPI = 300; // Very high resolution

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

interface Figure {
  image: string;
  pageIndex: number; // 1-based
  bounds: [number, number, number, number]; // [top, left, bottom, right] in POINTS
  originalBounds: [number, number, number, number];
}

function processFigures() {
  if (!fs.existsSync(JSON_PATH)) {
    console.error(`JSON manifest not found: ${JSON_PATH}`);
    return;
  }
  
  const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
  const figures: Figure[] = data.figures;
  
  console.log(`Found ${figures.length} figures to extract from PDF...`);
  
  // Group by page to avoid reloading PDF too many times? 
  // pdftocairo is fast per page.
  
  for (let i = 0; i < figures.length; i++) {
    const fig = figures[i];
    const safeName = path.basename(fig.image, path.extname(fig.image)).replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniqueName = `${safeName}_p${fig.pageIndex}`;
    const outFilePrefix = path.join(OUTPUT_DIR, uniqueName); 
    
    // Bounds: [y1, x1, y2, x2] (top, left, bottom, right)
    const topPt = fig.bounds[0];
    const leftPt = fig.bounds[1];
    const bottomPt = fig.bounds[2];
    const rightPt = fig.bounds[3];
    
    const widthPt = rightPt - leftPt;
    const heightPt = bottomPt - topPt;
    
    // Convert Points to Pixels at target DPI
    // 1 pt = 1/72 inch
    // px = pt * (DPI / 72)
    const scale = DPI / 72;
    const xPx = Math.round(leftPt * scale);
    const yPx = Math.round(topPt * scale);
    const wPx = Math.round(widthPt * scale);
    const hPx = Math.round(heightPt * scale);
    
    console.log(`[${i+1}/${figures.length}] Extracting ${uniqueName} (Page ${fig.pageIndex}) - ${wPx}x${hPx}px`);
    
    try {
      // pdftocairo -png -r [DPI] -f [page] -l [page] -x [x] -y [y] -W [w] -H [h] -transp -singlefile [pdf] [out_prefix]
      const cmd = `pdftocairo -png -r ${DPI} -f ${fig.pageIndex} -l ${fig.pageIndex} -x ${xPx} -y ${yPx} -W ${wPx} -H ${hPx} -transp -singlefile "${PDF_PATH}" "${outFilePrefix}"`;
      
      execSync(cmd, { stdio: 'ignore' });
    } catch (e) {
      console.error(`Failed to extract ${uniqueName}:`, e);
    }
  }
}

processFigures();

