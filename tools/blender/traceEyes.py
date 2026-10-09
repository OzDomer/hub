"""Trace the eye outlines from the 2D concept art, for nyxScene.EYE_OUTLINES.

Plain Python + Pillow (no Blender). For each eye it flood-fills from the pupil through iris-colored
pixels, takes the convex hull, normalises it to half-width 1 around the eye's centre (x right,
z up) and resamples 64 points by angle. Paste the printed dict over EYE_OUTLINES.

Usage: python traceEyes.py <concept.png> [check.png]
The default boxes and seeds match assets/source/nyxConceptDayNight.png (the DAY calm face
close-up, scaled 2x). For another image, adjust FACE_CROP, BOXES and SEEDS, and look at check.png.
"""
import json
import math
import sys

from PIL import Image, ImageDraw

FACE_CROP = (150, 500, 370, 700)       # DAY calm close-up in the concept sheet
SCALE = (440, 400)                      # resized to this before tracing
BOXES = {"left": (62, 180), "right": (244, 370)}   # x ranges of each eye (after resize)
SEEDS = {"left": (120, 300), "right": (320, 300)}  # a point inside each pupil
Y_RANGE = (248, 348)


def is_iris(px):
    r, g, b = px
    return b > 70 and b > r + 10


def hull(pts):
    pts = sorted(set(pts))

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def resample(h, count=64):
    xs = [p[0] for p in h]
    ys = [p[1] for p in h]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    hw = (max(xs) - min(xs)) / 2
    pts = [((x - cx) / hw, -(y - cy) / hw) for x, y in h]
    out = []
    for k in range(count):
        a = 2 * math.pi * k / count
        dx, dy = math.cos(a), math.sin(a)
        best = 0.0
        for i in range(len(pts)):
            x1, y1 = pts[i]
            x2, y2 = pts[(i + 1) % len(pts)]
            ex, ey = x2 - x1, y2 - y1
            den = dx * ey - dy * ex
            if abs(den) < 1e-9:
                continue
            t = (x1 * ey - y1 * ex) / den
            u = (x1 * dy - y1 * dx) / den
            if t > 0 and 0 <= u <= 1:
                best = max(best, t)
        out.append([round(best * dx, 4), round(best * dy, 4)])
    return out


im = Image.open(sys.argv[1]).convert("RGB").crop(FACE_CROP).resize(SCALE, Image.LANCZOS)
result, hulls = {}, {}
for name, (x0, x1) in BOXES.items():
    seed = SEEDS[name]
    seen, stack, pts = set(), [seed], []
    while stack:
        x, y = stack.pop()
        if (x, y) in seen or not (x0 <= x < x1 and Y_RANGE[0] <= y < Y_RANGE[1]):
            continue
        seen.add((x, y))
        px = im.getpixel((x, y))
        if not (is_iris(px) or (sum(px) < 40 and abs(x - seed[0]) < 14)):  # iris, or the dark pupil
            continue
        pts.append((x, y))
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    hulls[name] = hull(pts)
    result[name] = resample(hulls[name])
print(json.dumps(result))
if len(sys.argv) > 2:
    d = im.copy()
    dr = ImageDraw.Draw(d)
    for h in hulls.values():
        dr.polygon(h, outline=(255, 0, 0))
    d.save(sys.argv[2])
