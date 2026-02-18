import * as fs from 'fs';
import * as path from 'path';

const INPUT_JSON = path.resolve(__dirname, '../new_pipeline/output/af4_strict_bounds.json');
const OUTPUT_JSON = path.resolve(__dirname, '../new_pipeline/output/af4_merged_bounds.json');

interface Figure {
  image: string;
  pageIndex: number;
  bounds: [number, number, number, number]; // [top, left, bottom, right]
}

function mergeBounds() {
  if (!fs.existsSync(INPUT_JSON)) {
    console.error("Input JSON not found");
    return;
  }

  const data = JSON.parse(fs.readFileSync(INPUT_JSON, 'utf-8'));
  const figures: Figure[] = data.figures;

  // Normalize bounds first
  figures.forEach(f => {
    let [top, left, bottom, right] = f.bounds;
    if (top > bottom) [top, bottom] = [bottom, top];
    if (left > right) [left, right] = [right, left];
    f.bounds = [top, left, bottom, right];
  });

  // Group by page
  const byPage: { [key: number]: Figure[] } = {};
  figures.forEach(f => {
    if (!byPage[f.pageIndex]) byPage[f.pageIndex] = [];
    byPage[f.pageIndex].push(f);
  });

  const mergedFigures: Figure[] = [];

  for (const pageStr in byPage) {
    const pageIndex = parseInt(pageStr);
    let pageFigs = byPage[pageIndex];

    // Simple clustering: Merge if bounds overlap or are very close (e.g. 50pt)
    const MERGE_THRESHOLD = 50; 

    // We keep merging until no more changes
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < pageFigs.length; i++) {
        for (let j = i + 1; j < pageFigs.length; j++) {
          const a = pageFigs[i];
          const b = pageFigs[j];

          // Check intersection/proximity
          // Box A: [t1, l1, b1, r1]
          // Box B: [t2, l2, b2, r2]
          
          const expandedA = [a.bounds[0]-MERGE_THRESHOLD, a.bounds[1]-MERGE_THRESHOLD, a.bounds[2]+MERGE_THRESHOLD, a.bounds[3]+MERGE_THRESHOLD];
          
          const intersect = !(b.bounds[1] > expandedA[3] || 
                              b.bounds[3] < expandedA[1] || 
                              b.bounds[0] > expandedA[2] || 
                              b.bounds[2] < expandedA[0]);

          if (intersect) {
            // Merge B into A
            const newTop = Math.min(a.bounds[0], b.bounds[0]);
            const newLeft = Math.min(a.bounds[1], b.bounds[1]);
            const newBottom = Math.max(a.bounds[2], b.bounds[2]);
            const newRight = Math.max(a.bounds[3], b.bounds[3]);
            
            // Construct a composite name
            const nameA = path.basename(a.image, path.extname(a.image));
            const nameB = path.basename(b.image, path.extname(b.image));
            // Avoid ultra-long names
            const newName = (nameA + "_" + nameB).substring(0, 50) + "_merged.png";

            pageFigs[i] = {
              image: newName,
              pageIndex: pageIndex,
              bounds: [newTop, newLeft, newBottom, newRight]
            };
            
            // Remove B
            pageFigs.splice(j, 1);
            changed = true;
            break; // Restart loop
          }
        }
        if (changed) break;
      }
    }
    
    mergedFigures.push(...pageFigs);
  }

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify({ figures: mergedFigures }, null, 2));
  console.log(`Merged ${figures.length} figures into ${mergedFigures.length} composite figures.`);
}

mergeBounds();



