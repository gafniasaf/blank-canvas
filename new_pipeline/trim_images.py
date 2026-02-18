import os
import sys
from PIL import Image

target_dir = sys.argv[1] if len(sys.argv) > 1 else 'new_pipeline/assets/figures/ch1'

print(f"Trimming images in {target_dir}...")

count = 0
if not os.path.exists(target_dir):
    print(f"Directory not found: {target_dir}")
    sys.exit(1)

for filename in sorted(os.listdir(target_dir)):
    if not filename.lower().endswith('.png'):
        continue
        
    path = os.path.join(target_dir, filename)
    try:
        im = Image.open(path)
        
        # Get the bounding box of the non-zero regions
        bbox = im.getbbox()
        
        if bbox:
            current_area = im.width * im.height
            new_area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])
            
            # If we can save > 10% space or if dimensions change significantly
            if new_area < current_area * 0.99:
                print(f"  ✂️  {filename}: {im.size} -> {bbox} ({(1 - new_area/current_area)*100:.1f}% reduction)")
                cropped = im.crop(bbox)
                cropped.save(path)
                count += 1
            else:
                # print(f"  OK {filename}")
                pass
        else:
            print(f"  ⚠️ {filename} appears empty")
            
    except Exception as e:
        print(f"  ❌ Error {filename}: {e}")

print(f"Done. Trimmed {count} images.")































