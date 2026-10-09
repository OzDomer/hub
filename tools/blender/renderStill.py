"""Render one still of Nyx, for judging the look before animating anything.

Usage (from tools/blender):
  python renderStill.py <out.png> [day|night] [full|face]
full = the whole cat at 2x resolution (960x1120), face = a close-up of the eyes (440x400).
Writes the transparent render and <out>_dark.png composited on the near-black screen color.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy  # noqa: E402
import nyxScene as scene  # noqa: E402
from mathutils import Vector  # noqa: E402
from PIL import Image  # noqa: E402

args = scene.cli_args()
out = args[0]
night = len(args) > 1 and args[1] == "night"
face = len(args) > 2 and args[2] == "face"

arm, body = scene.setup_scene(width=440 if face else 480, height=400 if face else 560, samples=48)
pb = arm.pose.bones["tripo::Head_0"]
pb.rotation_mode = "XYZ"
pb.rotation_euler = (0, math.radians(-22), 0)  # head turned toward the camera (see the doc)
scene.animate_extras(0.3)
scene.set_night_eyes(night)
sc = bpy.context.scene
if face:
    cam = sc.camera
    bpy.context.view_layer.update()
    head = arm.matrix_world @ arm.pose.bones["tripo::Head_2"].head
    fwd = cam.matrix_world.to_3x3() @ Vector((0, 0, -1))
    cam.location = head + Vector((0, 0, 0.12)) - fwd * 3.0
    cam.data.ortho_scale = 0.42
else:
    sc.render.resolution_percentage = 200
    for ls in bpy.context.view_layer.freestyle_settings.linesets:
        ls.linestyle.thickness *= 1.5
sc.render.filepath = out
bpy.ops.render.render(write_still=True)

im = Image.open(out)
bg = Image.new("RGBA", im.size, (5, 6, 10, 255))
bg.alpha_composite(im)
bg.save(out.replace(".png", "_dark.png"))
