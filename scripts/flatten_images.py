import os
from PIL import Image

CROP_DIR = "new_pipeline/output/af4_strict_crops"

if not os.path.exists(CROP_DIR):
    print(f"Directory not found: {CROP_DIR}")
    exit(1)

files = [f for f in os.listdir(CROP_DIR) if f.lower().endswith(".png")]
print(f"Flattening {len(files)} images...")

for f in files:
    path = os.path.join(CROP_DIR, f)
    try:
        img = Image.open(path)
        if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
            # Create white background
            bg = Image.new("RGB", img.size, (255, 255, 255))
            if img.mode != 'RGBA':
                img = img.convert('RGBA')
            bg.paste(img, mask=img.split()[3]) # 3 is alpha channel
            bg.save(path)
            # print(f"Flattened {f}")
        else:
            # print(f"Skipped {f} (no alpha)")
            pass
    except Exception as e:
        print(f"Error processing {f}: {e}")

print("Done flattening.")



