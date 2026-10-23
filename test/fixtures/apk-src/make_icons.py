import os, sys
from PIL import Image, ImageDraw
res = sys.argv[1]
for dens, size in [('mdpi', 48), ('xhdpi', 96)]:
    d = os.path.join(res, f'mipmap-{dens}'); os.makedirs(d, exist_ok=True)
    img = Image.new('RGBA', (size, size), (61, 139, 253, 255))
    ImageDraw.Draw(img).rectangle([size//4, size//4, 3*size//4, 3*size//4], fill=(255, 255, 255, 255))
    img.save(os.path.join(d, 'ic_launcher.png'))
d = os.path.join(res, 'drawable-xhdpi'); os.makedirs(d, exist_ok=True)
Image.new('RGBA', (320, 180), (20, 20, 30, 255)).save(os.path.join(d, 'banner.png'))
