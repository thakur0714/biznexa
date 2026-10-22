import sys
from PIL import Image, ImageDraw, ImageFont
out = sys.argv[1]
NAVY = (31, 43, 122, 255); GOLD = (244, 176, 0, 255); WHITE = (255, 255, 255, 255)
FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
S = 4  # supersample

def mark(size, glyph_h, bg=None, radius=0, fg=WHITE):
    """White B with a marigold dot at its bottom-right, centred in a size x size canvas."""
    n = size * S
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if bg:
        d.rounded_rectangle([0, 0, n - 1, n - 1], radius=radius * S, fill=bg)
    font = ImageFont.truetype(FONT, int(glyph_h * S * 1.38))
    l, t, r, b = d.textbbox((0, 0), "B", font=font)
    w, h = r - l, b - t
    x = (n - w) / 2 - l - w * 0.04
    y = (n - h) / 2 - t
    d.text((x, y), "B", font=font, fill=fg)
    # dot sits on the B's bottom-right corner, ringed in navy so it reads as a separate shape
    dr = h * 0.17
    cx, cy = (n + w) / 2 + w * 0.02, (n + h) / 2 - dr * 0.55
    ring = dr * 0.32
    d.ellipse([cx - dr - ring, cy - dr - ring, cx + dr + ring, cy + dr + ring], fill=bg or NAVY)
    d.ellipse([cx - dr, cy - dr, cx + dr, cy + dr], fill=GOLD)
    return img.resize((size, size), Image.LANCZOS)

mark(1024, 520, NAVY, 230).save(f"{out}/icon.png")
# Adaptive icon: the launcher crops to the central ~66%, so keep the glyph small. Navy comes from backgroundColor.
fg = mark(1024, 380, NAVY, 0); fg.save(f"{out}/adaptive-icon.png")
mark(512, 300, NAVY, 110).save(f"{out}/splash-icon.png")
# In-app logo sits on the navy loader, so invert it: white tile, navy B.
mark(256, 130, WHITE, 58, NAVY).save(f"{out}/logo.png")
