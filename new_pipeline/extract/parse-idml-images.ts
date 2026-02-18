import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import xml2js from 'xml2js';
import { fileURLToPath } from 'url';

// ESM compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ImagePlacement {
  filename: string;
  spreadId: string;
  pageIndexOnSpread: number; // 0 for left, 1 for right (usually)
  pageName: string; // "ii", "3", etc.
  x: number;
  y: number;
  width: number;
  height: number;
  linkResourceUri: string;
}

async function parseIdmlImages(idmlPath: string): Promise<ImagePlacement[]> {
  const zip = new AdmZip(idmlPath);
  const parser = new xml2js.Parser();
  const placements: ImagePlacement[] = [];

  // 1. Read designmap.xml to understand page order and spreads
  const designMapEntry = zip.getEntry('designmap.xml');
  if (!designMapEntry) throw new Error('designmap.xml not found in IDML');
  
  const designMap = await parser.parseStringPromise(designMapEntry.getData().toString('utf8'));
  const spreads = designMap.Document['idPkg:Spread'] || [];
  
  // Map Spread Source (src) to Page Names
  // Actually, simpler to just iterate over spreads in the order they appear in designmap (if they are ordered there)
  // or just process all spreads found in the zip.
  
  console.error(`Found ${spreads.length} spreads in designmap.`);

  // 2. Iterate over each spread
  for (const spreadRef of spreads) {
    const src = spreadRef.$.src;
    const spreadEntry = zip.getEntry(src);
    if (!spreadEntry) continue;

    const spreadXml = await parser.parseStringPromise(spreadEntry.getData().toString('utf8'));
    const spread = spreadXml['idPkg:Spread'].Spread[0];
    const spreadId = spread.$.Self;
    
    // Get Pages on this spread
    const pages = spread.Page || [];
    
    // Find Rectangles with Images
    // Rectangles can be direct children of Spread or inside Groups
    const rectangles = findRectangles(spread);
    
    for (const rect of rectangles) {
      const image = rect.Image ? rect.Image[0] : null;
      if (!image) continue;
      
      const link = image.Link ? image.Link[0] : null;
      if (!link) continue;
      
      const uri = link.$.LinkResourceURI;
      if (!uri) continue;
      
      // Parse transform to get position
      // ItemTransform="a b c d tx ty"
      // Default: "1 0 0 1 0 0"
      const transform = rect.$.ItemTransform ? rect.$.ItemTransform.split(' ').map(Number) : [1, 0, 0, 1, 0, 0];
      const tx = transform[4] || 0;
      const ty = transform[5] || 0;
      
      // Determine Page
      // Heuristic: If tx < 0, it's the left page (index 0). If tx >= 0, right page (index 1).
      // This assumes a standard 2-page spread centered at 0.
      // Adjust based on page count.
      let pageIndex = 0;
      if (pages.length > 1) {
        if (tx >= 0) pageIndex = 1;
      }
      // Clamp
      if (pageIndex >= pages.length) pageIndex = pages.length - 1;
      
      const page = pages[pageIndex];
      const pageName = page.$.Name;
      
      // Extract Filename from URI
      // URI format: file:/path/to/Links/Image.tif
      const filename = decodeURIComponent(uri.split('/').pop() || '');
      
      placements.push({
        filename,
        spreadId,
        pageIndexOnSpread: pageIndex,
        pageName,
        x: tx,
        y: ty,
        width: 0, // Todo: calculate from path geometry if needed
        height: 0,
        linkResourceUri: uri
      });
    }
  }

  return placements;
}

function findRectangles(obj: any): any[] {
  let rects: any[] = [];
  
  if (obj.Rectangle) {
    rects = rects.concat(obj.Rectangle);
  }
  
  // Recursively search in Groups
  if (obj.Group) {
    for (const group of obj.Group) {
      rects = rects.concat(findRectangles(group));
    }
  }
  
  return rects;
}

async function main() {
  const idmlPath = process.argv[2];
  if (!idmlPath) {
    console.error('Usage: npx tsx parse-idml-images.ts <path-to-idml>');
    process.exit(1);
  }

  try {
    const images = await parseIdmlImages(idmlPath);
    console.log(JSON.stringify(images, null, 2));
  } catch (error) {
    console.error('Error parsing IDML:', error);
    process.exit(1);
  }
}

main();

