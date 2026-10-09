"""Render Nyx's animation clips as layered passes.

Every clip is rendered twice-or-more:
  body pass  - everything except the eyes (one per clip)
  eyes pass  - only the eyes, the body as a holdout so the head still hides what it should,
               one per eye state (mood x day/night). The frontend draws the eyes over the body.
That keeps moods and day/night as small overlays instead of re-rendering the whole cat for each.

Usage (from tools/blender):  python renderClip.py <clip> <pass> <first> <last> <outdir>
   or with the Blender app:  blender -b --python renderClip.py -- <clip> <pass> <first> <last> <outdir>
  clip: idle | sleep | eat | play
  pass: body | eyes:<mood>:<day|night>   (mood: calm, happy, sleepy, grumpy, closed, content)
"""
import math
import os
import sys
import time

from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy  # noqa: E402
import nyxScene as scene  # noqa: E402
from mathutils import Vector  # noqa: E402

_args = scene.cli_args()
CLIP, PASS, FIRST, LAST, OUT = _args[0], _args[1], int(_args[2]), int(_args[3]), _args[4]
CLIPS = {"idle": 96, "sleep": 96, "eat": 48, "play": 48}  # frames at 12 fps
FRAMES = CLIPS[CLIP]
HEAD_YAW = -22.0

MOODS = {
    "calm": dict(lid=0.0, lid_angle=0.0, pupil=0.2),
    "happy": dict(lid=0.0, lid_angle=0.0, pupil=0.34),
    "sleepy": dict(lid=0.5, lid_angle=0.0, pupil=0.2),
    "grumpy": dict(lid=0.38, lid_angle=0.5, pupil=0.09),
    "content": dict(lid=0.3, lid_angle=0.0, pupil=0.22),
    "sad": dict(lid=0.34, lid_angle=-0.45, pupil=0.24),
    "closed": dict(lid=1.0, lid_angle=0.0, pupil=0.2),
}

arm, body = scene.setup_scene()
sc = bpy.context.scene
TAIL = [f"tripo::Tail_{i}" for i in range(9)] + ["bone_35"]
for pb in arm.pose.bones:
    pb.rotation_mode = "XYZ"
eye_mid = (scene.EYE_POINTS[0] + scene.EYE_POINTS[1]) / 2


def deg(a):
    return math.radians(a)


from mathutils import Quaternion  # noqa: E402


def set_rot(name, pitch=0.0, yaw=0.0, side=0.0):
    """Rotate a bone by angles in *armature* space, whatever the bone's own roll:
    pitch about X (nod forward / back), yaw about the bone's own length axis, side about Y (lean).
    The auto-rig's bone rolls are arbitrary, so local Euler X isn't a clean nod."""
    pb = arm.pose.bones[name]
    rest = arm.data.bones[name].matrix_local.to_3x3()
    q_arm = Quaternion((1, 0, 0), deg(pitch)) @ Quaternion((0, 1, 0), deg(side))
    q_local = (rest.inverted() @ q_arm.to_matrix() @ rest).to_quaternion()
    q_local = q_local @ Quaternion((0, 1, 0), deg(yaw))
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = q_local


def blink(t, times, width=0.008):
    return max((math.exp(-((t - tb) / width) ** 2) for tb in times), default=0.0)


def reset():
    for pb in arm.pose.bones:
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)


def pose_idle(t):
    w = 2 * math.pi * t
    pb = arm.pose.bones
    set_rot("tripo::Spine_1", pitch=-1.2 * math.sin(2 * w))
    set_rot("tripo::Spine_2", pitch=0.7 * math.sin(2 * w))
    set_rot("tripo::Head_0", pitch=1.0 * math.sin(w + 1.1), yaw=HEAD_YAW + 3.0 * math.sin(w))
    for i, name in enumerate(TAIL):
        pb[name].rotation_euler = (0, 0, deg((1.0 + 0.45 * i) * math.sin(2 * w - 0.35 * i)))
    flick = math.exp(-((t - 0.55) ** 2) / (2 * 0.012 ** 2))
    pb["bone_9"].rotation_euler = (deg(-18 * flick), 0, 0)
    scene.set_crown_glow(1.0)
    return blink(t, (30 / 96, 75 / 96))


def pose_sleep(t):
    w = 2 * math.pi * t
    pb = arm.pose.bones
    # head lowered and resting, slow deep breaths (one every 4 s)
    set_rot("tripo::Spine_1", pitch=-2.2 * math.sin(2 * w))
    set_rot("tripo::Spine_2", pitch=6 + 1.0 * math.sin(2 * w))
    set_rot("tripo::Head_0", pitch=12 - 1.2 * math.sin(2 * w - 0.6), yaw=HEAD_YAW)
    for i, name in enumerate(TAIL):
        pb[name].rotation_euler = (0, 0, deg((0.5 + 0.2 * i) * math.sin(w - 0.3 * i)))
    pb["bone_9"].rotation_euler = (deg(6), 0, 0)  # ears relaxed
    pb["tripo::Head_3"].rotation_euler = (deg(5), 0, 0)
    # the crown dims and slowly glows while she sleeps
    scene.set_crown_glow(0.35 + 0.1 * math.sin(2 * w))
    return 0.0


def pose_eat(t):
    w = 2 * math.pi * t
    pb = arm.pose.bones
    bite = 0.5 - 0.5 * math.cos(3 * w)  # three nibbles per loop, in step with the starlight stream
    set_rot("tripo::Spine_1", pitch=-1.0 * math.sin(w))
    set_rot("tripo::Spine_2", pitch=5 + 3 * bite)
    set_rot("tripo::Head_0", pitch=10 + 7 * bite, yaw=HEAD_YAW)
    for i, name in enumerate(TAIL):
        pb[name].rotation_euler = (0, 0, deg((1.4 + 0.5 * i) * math.sin(2 * w - 0.35 * i)))  # happy tail
    scene.set_crown_glow(1.0)
    return 0.0


def pose_play(t):
    w = 2 * math.pi * t
    pb = arm.pose.bones
    # the toy loops in a figure-eight in front of her; she follows it with her head
    center = eye_mid + Vector((0.04, -0.3, -0.15))
    toy = center + Vector((0.1 * math.sin(w), 0.0, 0.06 * math.sin(2 * w)))
    scene.place_toy(toy, True)
    set_rot("tripo::Spine_1", pitch=-1.5 * math.sin(2 * w))
    set_rot("tripo::Spine_2", pitch=3 + 3 * math.sin(2 * w))
    set_rot("tripo::Head_0", pitch=5 + 5 * math.sin(2 * w), yaw=HEAD_YAW + 11 * math.sin(w - 0.25))
    for i, name in enumerate(TAIL):
        pb[name].rotation_euler = (0, 0, deg((2.2 + 0.8 * i) * math.sin(2 * w - 0.45 * i)))  # lively tail
    pb["bone_9"].rotation_euler = (deg(-8 - 6 * max(0.0, math.sin(2 * w))), 0, 0)  # ears perked
    scene.set_crown_glow(1.0)
    return blink(t, (0.7,))


POSES = {"idle": pose_idle, "sleep": pose_sleep, "eat": pose_eat, "play": pose_play}

# --- pass setup ---
eye_objects = [o for o in bpy.data.objects if o.name.startswith("Eye")]
if PASS == "body":
    for o in eye_objects:
        o.hide_render = True
else:
    _, mood, phase = PASS.split(":")
    scene.set_night_eyes(phase == "night")
    keep = set(eye_objects)
    for o in bpy.data.objects:
        if o.type in ("MESH",) and o not in keep and o is not body:
            o.hide_render = True
    body.is_holdout = True
    sc.render.use_freestyle = False

start = time.time()
for f in range(FIRST, LAST + 1):
    if os.path.exists(f"{OUT}/f{f:03d}.png"):
        continue  # already rendered (lets a restarted batch resume)
    t = f / FRAMES
    reset()
    blink_amt = POSES[CLIP](t)
    bpy.context.view_layer.update()
    scene.animate_extras(t)
    scene.animate_food(t, CLIP == "eat")
    if CLIP != "play":
        scene.place_toy(Vector(), False)
    if PASS != "body":
        st = dict(MOODS[mood])
        st["lid"] = max(st["lid"], blink_amt)
        scene.set_eyes(**st)
        # keep helpers hidden in the eye pass even if a pose function shows them
        for o in bpy.data.objects:
            if o.type == "MESH" and o not in keep and o is not body:
                o.hide_render = True
    bpy.context.view_layer.update()
    if PASS != "body":
        from bpy_extras.object_utils import world_to_camera_view
        pts = []
        for o in eye_objects:
            for c in o.bound_box:
                v = world_to_camera_view(sc, sc.camera, o.matrix_world @ Vector(c))
                pts.append(v)
        m = 0.09
        sc.render.use_border = True
        sc.render.use_crop_to_border = False
        sc.render.border_min_x = max(0.0, min(p.x for p in pts) - m)
        sc.render.border_max_x = min(1.0, max(p.x for p in pts) + m)
        sc.render.border_min_y = max(0.0, min(p.y for p in pts) - m)
        sc.render.border_max_y = min(1.0, max(p.y for p in pts) + m)
    sc.render.filepath = f"{OUT}/f{f:03d}.png"
    bpy.ops.render.render(write_still=True)
print("rendered", LAST - FIRST + 1, "frames in", round(time.time() - start, 1), "s")
