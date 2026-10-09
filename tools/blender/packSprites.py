"""Pack the rendered passes into what the frontend loads.

Output (outdir/):
  nyx.json                    manifest: frame size, fps, clips, eye variants and where to draw them
  <clip>.webp                 body sprite sheet (all clips share one frame size and anchor)
  <clip>_eyes_<variant>.webp  eye overlay sheets (small: cropped to the eyes)
  tools/blender/out/previews/ composited previews (body + eyes, crossfaded at 24 fps, two loops) and moods.png;
                              kept out of the frontend assets so they never ship

Usage (from tools/blender): python packSprites.py out/anim ../../frontend/src/assets/nyx
(plain Python + Pillow, and ffmpeg on the PATH for the previews)
"""
import json
import os
import subprocess
import sys

from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
COLS = 12
FPS = 12
PREVIEWS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "previews")
os.makedirs(PREVIEWS, exist_ok=True)

clips = {}
for clip in sorted(os.listdir(SRC)):
    passes = sorted(os.listdir(f"{SRC}/{clip}"))
    n = len(os.listdir(f"{SRC}/{clip}/body"))
    clips[clip] = {"frames": n, "eyes": [p[len("eyes_"):] for p in passes if p.startswith("eyes_")]}


def load(clip, pas, i):
    return Image.open(f"{SRC}/{clip}/{pas}/f{i:03d}.png").convert("RGBA")


def bbox_union(boxes):
    boxes = [b for b in boxes if b]
    return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))


def alpha_box(im):
    return im.getchannel("A").point(lambda a: 255 if a > 3 else 0).getbbox()


# one shared body crop for every clip, so switching clips never makes her jump
body_box = bbox_union([alpha_box(load(c, "body", i)) for c, info in clips.items() for i in range(info["frames"])])
pad = 4
W0, H0 = load(next(iter(clips)), "body", 0).size
body_box = (max(0, body_box[0] - pad), max(0, body_box[1] - pad), min(W0, body_box[2] + pad), min(H0, body_box[3] + pad))
FW, FH = body_box[2] - body_box[0], body_box[3] - body_box[1]


def sheet(frames, path):
    w, h = frames[0].size
    rows = (len(frames) + COLS - 1) // COLS
    out = Image.new("RGBA", (w * COLS, h * rows), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        out.alpha_composite(f, ((i % COLS) * w, (i // COLS) * h))
    out.save(path, quality=90, method=6)


manifest = {"frameWidth": FW, "frameHeight": FH, "fps": FPS, "columns": COLS, "crossfade": True, "clips": {}}
bodies = {}
for clip, info in clips.items():
    n = info["frames"]
    frames = [load(clip, "body", i).crop(body_box) for i in range(n)]
    bodies[clip] = frames
    sheet(frames, f"{OUT}/{clip}.webp")
    entry = {"frames": n, "sheet": f"{clip}.webp", "eyes": {}}
    # eye overlays: crop to the union of every eye variant of this clip
    eb = bbox_union([alpha_box(load(clip, f"eyes_{v}", i)) for v in info["eyes"] for i in range(n)])
    eb = (max(eb[0] - 2, body_box[0]), max(eb[1] - 2, body_box[1]), min(eb[2] + 2, body_box[2]), min(eb[3] + 2, body_box[3]))
    for v in info["eyes"]:
        ef = [load(clip, f"eyes_{v}", i).crop(eb) for i in range(n)]
        sheet(ef, f"{OUT}/{clip}_eyes_{v}.webp")
        entry["eyes"][v] = {"sheet": f"{clip}_eyes_{v}.webp", "x": eb[0] - body_box[0], "y": eb[1] - body_box[1],
                            "width": eb[2] - eb[0], "height": eb[3] - eb[1]}
    manifest["clips"][clip] = entry
json.dump(manifest, open(f"{OUT}/nyx.json", "w"), indent=2)


def preview(clip, variant, name):
    n = clips[clip]["frames"]
    e = manifest["clips"][clip]["eyes"][variant]
    comp = []
    for i in range(n):
        f = bodies[clip][i].copy()
        f.alpha_composite(load(clip, f"eyes_{variant}", i).crop((body_box[0] + e["x"], body_box[1] + e["y"],
                                                                  body_box[0] + e["x"] + e["width"], body_box[1] + e["y"] + e["height"])),
                          (e["x"], e["y"]))
        comp.append(f)
    tmp = f"{PREVIEWS}/_tmp"
    os.makedirs(tmp, exist_ok=True)
    k = 0
    for _ in range(2):
        for i in range(n):
            for t in (0.0, 0.5):
                m = Image.blend(comp[i], comp[(i + 1) % n], t)
                bg = Image.new("RGBA", (FW + FW % 2, FH + FH % 2), (5, 6, 10, 255))
                bg.alpha_composite(m)
                bg.convert("RGB").save(f"{tmp}/p{k:04d}.png")
                k += 1
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "24", "-i", f"{tmp}/p%04d.png",
                    "-vf", "scale=iw*2:ih*2:flags=lanczos", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
                    f"{PREVIEWS}/{name}.mp4"], check=True)
    subprocess.run(["rm", "-rf", tmp])


for clip, variant, name in (("idle", "calm_day", "idle_calm_day"), ("idle", "calm_night", "idle_calm_night"),
                            ("sleep", "closed_day", "sleep"), ("eat", "content_day", "eat"),
                            ("play", "happy_day", "play")):
    if variant in clips.get(clip, {}).get("eyes", []):
        preview(clip, variant, name)

# a still of every eye variant on the idle body, for checking moods at a glance
idle = clips.get("idle")
if idle:
    tiles = []
    for v in idle["eyes"]:
        e = manifest["clips"]["idle"]["eyes"][v]
        f = bodies["idle"][0].copy()
        f.alpha_composite(load("idle", f"eyes_{v}", 0).crop((body_box[0] + e["x"], body_box[1] + e["y"],
                                                             body_box[0] + e["x"] + e["width"], body_box[1] + e["y"] + e["height"])),
                          (e["x"], e["y"]))
        bg = Image.new("RGBA", f.size, (5, 6, 10, 255))
        bg.alpha_composite(f)
        tiles.append(bg.crop((int(FW * 0.35), 0, FW, int(FH * 0.55))))
    tw, th = tiles[0].size
    cols = 4
    out = Image.new("RGB", (tw * cols, th * ((len(tiles) + cols - 1) // cols)), (5, 6, 10))
    for i, t in enumerate(tiles):
        out.paste(t.convert("RGB"), ((i % cols) * tw, (i // cols) * th))
    out.save(f"{PREVIEWS}/moods.png")
print("frame", FW, FH, "clips", {c: i["frames"] for c, i in clips.items()})
