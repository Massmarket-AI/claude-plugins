#!/usr/bin/env python3
"""Regenerate the extension's icon set from the Massmarket brand mark (v0.11.3).

    python3 gen_icons.py [--brand-icon PATH]      # needs Pillow: python3 -m pip install pillow

What it writes (all into icons/):

  icon16.png, icon32.png   HAND-DRAWN. The two toolbar sizes are pixel grids written
                           out below, not downscales: at 16 and 32 px the brand's
                           brain is a grey smear when it is resampled. Both keep the
                           mark's structure — the solid back of the brain, the
                           circuit traces ending in nodes, the stem — on an ink tile
                           so the icon reads on a light AND a dark toolbar. Edit a
                           grid to change the icon; 'P' is paper, '.' is ink, and
                           'o' / '+' / '-' are 78 / 55 / 30 % paper for the edges.
  icon48.png, icon128.png  The brand mark itself, resampled (Lanczos) onto the same
                           ink tile — 40px tile + 4px margin at 48, and the Web
                           Store's 96px tile + 16px margin at 128. At 48 the mark is
                           first simplified (a morphological close fills the gaps
                           narrower than one output pixel) so it stays crisp.
  brand-mark.png           The ink brain on transparency, for the surfaces' headers
                           (brand.css → --mm-mark).

Source: massmarket-ai-rebrand/src/app/icon.png (512px, black brain with a light halo
and a registered mark). The halo is dropped by keeping only the dark coverage, and
the ® is erased — it is illegible at icon sizes. Colours are the brand's ink #0a0a0a
and paper #f2efe8.

Until v0.11.2 this file drew a flat green square with a white dot and needed no
third-party package; that icon is gone with the rebrand.
"""
import argparse
import os

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, 'icons')
INK = (10, 10, 10)
PAPER = (242, 239, 232)
LEVEL = {'P': 1.0, 'o': 0.78, '+': 0.55, '-': 0.3, '.': 0.0}

ICON16 = [
    '................',
    '................',
    '................',
    '.....+PPPPP+....',
    '...+PP.....PPP..',
    '..+P..PPPP.PPPP.',
    '..P..P....PPPPP.',
    '.+P.P..PP..P..P.',
    '.P..P.PPPPPP..P.',
    '.P..P.......PPP.',
    '.+P..PPPPPPPPPP.',
    '..+P.....PPPP+..',
    '....+PPPPP+.....',
    '........PP......',
    '........P+......',
    '................',
]

ICON32 = [
    '................................',
    '................................',
    '................................',
    '................................',
    '.............+PPPP+.............',
    '..........+PPPPPPPPPPP+.........',
    '........+PP......+PPPPPPP.......',
    '.......P+...+PPPPP+PPPPPPP......',
    '.......P..PP.....P.....PPPP.....',
    '.....P.P..PP....P....+P..PPP....',
    '....P..P....+PPP......PPP..PP...',
    '...P..P...PP...........PPP.PP...',
    '...P.P..PP.....+PPPPP..PPPPPP...',
    '..+.P..P+PPPPPP+.......PPPPPP...',
    '..P..P.P..+P..........+PPPPPP+..',
    '..P..P..PP+..........+PPP..PPP..',
    '...P.P..P.....+PPPPPPPPPPP..PP..',
    '...+P.P..+...PPP...+PPPPPPPPPP..',
    '....+PP....PP.......+..PPPPPP...',
    '......PP..P......+PP....PPPPP...',
    '.......+..P...PPP..P...+..PP....',
    '........+.PPP+.........PP.P.....',
    '..........+.....+++.+PPPP.......',
    '..............+PPPPPPPPPPP......',
    '...............PP...+PPP+.......',
    '...............PP...............',
    '...............+................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
]


def from_grid(rows):
    size = len(rows)
    img = Image.new('RGBA', (size, size), INK + (255,))
    px = img.load()
    for y, row in enumerate(rows):
        assert len(row) == size, (y, len(row))
        for x, ch in enumerate(row):
            t = LEVEL[ch]
            px[x, y] = tuple(round(INK[i] * (1 - t) + PAPER[i] * t) for i in range(3)) + (255,)
    return img


def brain_mask(brand_icon):
    """Dark coverage of the brand icon, registered mark erased, cropped to the brain."""
    src = Image.open(brand_icon).convert('RGBA')
    w, h = src.size
    mask = Image.new('L', src.size, 0)
    sp, mp = src.load(), mask.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = sp[x, y]
            mp[x, y] = int(round(a * (1 - (r + g + b) / 3 / 255)))
    # The ® sits above the back of the brain, clear of it (measured on the 512px source).
    sx, sy = w / 512, h / 512
    for y in range(0, int(170 * sy)):
        for x in range(int(414 * sx), w):
            mp[x, y] = 0
    return mask.crop(mask.getbbox())


def closed(mask, k):
    """Threshold, then a morphological close of size k (fills ink gaps thinner than k)."""
    m = mask.point(lambda v: 255 if v > 127 else 0)
    if not k:
        return m
    pad = 40
    big = Image.new('L', (m.size[0] + 2 * pad, m.size[1] + 2 * pad), 0)
    big.paste(m, (pad, pad))
    big = big.filter(ImageFilter.MaxFilter(k)).filter(ImageFilter.MinFilter(k))
    return big.crop((pad, pad, pad + m.size[0], pad + m.size[1]))


def mark_on_tile(master, size, tile, brain_w):
    bw, bh = master.size
    w, h = brain_w, round(bh * brain_w / bw)
    small = master.resize((w * 4, h * 4), Image.LANCZOS).resize((w, h), Image.LANCZOS)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    pad = (size - tile) // 2
    ImageDraw.Draw(out).rectangle([pad, pad, pad + tile - 1, pad + tile - 1], fill=INK + (255,))
    paper = Image.new('RGBA', (w, h), PAPER + (255,))
    paper.putalpha(small)
    out.alpha_composite(paper, ((size - w) // 2, round((size - h) / 2)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--brand-icon', default=os.path.expanduser('~/Projects/massmarket-ai-rebrand/src/app/icon.png'))
    args = ap.parse_args()
    os.makedirs(OUT_DIR, exist_ok=True)
    mask = brain_mask(args.brand_icon)
    full, simple = closed(mask, 0), closed(mask, 11)
    icons = {
        'icon16.png': from_grid(ICON16),
        'icon32.png': from_grid(ICON32),
        'icon48.png': mark_on_tile(simple, 48, 40, 32),
        'icon128.png': mark_on_tile(full, 128, 96, 74),
    }
    bw, bh = simple.size
    w = 128
    h = round(bh * w / bw)
    alpha = simple.resize((w * 4, h * 4), Image.LANCZOS).resize((w, h), Image.LANCZOS)
    mark = Image.new('RGBA', (w, h), INK + (255,))
    mark.putalpha(alpha)
    icons['brand-mark.png'] = mark
    for name, img in icons.items():
        path = os.path.join(OUT_DIR, name)
        img.save(path, optimize=True)
        print('wrote', path, img.size)


if __name__ == '__main__':
    main()
