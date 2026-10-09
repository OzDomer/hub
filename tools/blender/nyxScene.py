"""Build Nyx's render scene from the rigged Tripo GLB (headless Blender).

Look: fully emissive (no lights), like the 2D art.
- body: deep night with stars and a faint purple nebula, glowing lavender rim at the silhouette
- eyes: separate glowing objects over the sculpted eye bulges (so they can blink / switch day-night later)
- crown: three cream-gold 4-point stars floating above the head
Stars and nebula are mapped on the *rest pose* positions, so they stick to her when bones move.
"""
import math
import bpy
from mathutils import Vector, Matrix

from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
GLB = str(REPO / "assets" / "source" / "nyxTripo.glb")


def cli_args():
    """Arguments after '--' when run inside the Blender app (blender -b --python x.py -- a b),
    otherwise the normal ones (python x.py a b, with the pip 'bpy' module)."""
    import sys
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]


def hex_rgb(h, a=1.0):
    h = h.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*lin, a)


def setup_scene(width=480, height=560, samples=24):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=GLB)
    for o in list(bpy.data.objects):
        if o.name.startswith("Icosphere"):
            bpy.data.objects.remove(o)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    body = next(o for o in bpy.data.objects if o.type == "MESH")
    body.name = "NyxBody"

    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.render.film_transparent = True
    sc.render.resolution_x, sc.render.resolution_y = width, height
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"

    world = bpy.data.worlds.new("World")
    sc.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.0

    store_rest_positions(body)
    store_tip(body)
    body.data.materials.clear()
    body.data.materials.append(night_material())
    for poly in body.data.polygons:
        poly.use_smooth = True

    add_camera(body)
    add_eyes(arm, body)
    add_crown(arm)
    add_stardust(arm)
    add_body_sparkles(arm, body)
    add_wisps(arm)
    add_food(arm, body)
    add_toy(arm)
    add_glow_compositor()
    add_outline()
    return arm, body


def store_tip(body):
    """0 on the body, rising to 1 at the tail tip (from the tail bones' skin weights)."""
    groups = {g.name: g.index for g in body.vertex_groups}
    weights = {groups["bone_35"]: 1.0, groups["tripo::Tail_8"]: 0.85, groups["tripo::Tail_7"]: 0.62, groups["tripo::Tail_6"]: 0.4, groups["tripo::Tail_5"]: 0.18}
    tail_groups = {groups[f"tripo::Tail_{i}"]: (i + 1) / 10 for i in range(9)}
    tail_groups[groups["bone_35"]] = 1.0
    tail_attr = body.data.attributes.new("tailness", "FLOAT", "POINT")
    for v in body.data.vertices:
        tail_attr.data[v.index].value = min(1.0, sum(g.weight * tail_groups.get(g.group, 0.0) for g in v.groups))
    attr = body.data.attributes.new("tip", "FLOAT", "POINT")
    values = []
    for v in body.data.vertices:
        t = sum(g.weight * weights.get(g.group, 0.0) for g in v.groups)
        values.append(min(1.0, t))
    for i, t in enumerate(values):
        attr.data[i].value = t
    # faces mostly dissolved get a Freestyle mark, so no outline is drawn around the invisible part
    marks = body.data.attributes.get("freestyle_face") or body.data.attributes.new("freestyle_face", "BOOLEAN", "FACE")
    eye_pts = [body.matrix_world.inverted() @ p for p in EYE_POINTS]
    zone = body.data.attributes.new("eye_zone", "FLOAT", "POINT")
    for v in body.data.vertices:
        dmin = min((v.co - e).length for e in eye_pts)
        zone.data[v.index].value = max(0.0, min(1.0, (0.115 - dmin) / 0.02))
    for poly in body.data.polygons:
        tail_end = sum(values[i] for i in poly.vertices) / len(poly.vertices) > 0.75
        near_eye = any((poly.center - e).length < 0.088 for e in eye_pts)
        marks.data[poly.index].value = tail_end or near_eye


def store_rest_positions(body):
    """Save each vertex's rest position as an attribute, so the starfield sticks to the skin."""
    attr = body.data.attributes.new("rest_pos", "FLOAT_VECTOR", "POINT")
    for i, v in enumerate(body.data.vertices):
        attr.data[i].vector = v.co


def ramp(n, stops):
    r = n.new("ShaderNodeValToRGB")
    els = r.color_ramp.elements
    while len(els) < len(stops):
        els.new(0.5)
    for el, (pos, col) in zip(els, stops):
        el.position = pos
        el.color = col if isinstance(col, tuple) else hex_rgb(col)
    return r


def math_node(n, op, a=None, b=None, c=None):
    m = n.new("ShaderNodeMath")
    m.operation = op
    for i, v in enumerate((a, b, c)):
        if v is not None:
            m.inputs[i].default_value = v
    return m


def mix_rgb(n, l, blend, fac, a, b):
    m = n.new("ShaderNodeMix")
    m.data_type = "RGBA"
    m.blend_type = blend
    if isinstance(fac, float):
        m.inputs["Factor"].default_value = fac
    else:
        l.new(fac, m.inputs["Factor"])
    for sock, val in (("A", a), ("B", b)):
        if isinstance(val, tuple):
            m.inputs[sock].default_value = val
        else:
            l.new(val, m.inputs[sock])
    return m.outputs["Result"]


def night_material():
    """Night-sky body: volume gradient, a galaxy band, two sizes of stars, a lavender rim,
    and a tail tip that dissolves into transparency (attribute 'tip')."""
    m = bpy.data.materials.new("NyxNight")
    m.use_nodes = True
    nt = m.node_tree
    n, l = nt.nodes, nt.links
    n.clear()
    out = n.new("ShaderNodeOutputMaterial")
    emit = n.new("ShaderNodeEmission")
    transparent = n.new("ShaderNodeBsdfTransparent")
    shader_mix = n.new("ShaderNodeMixShader")
    l.new(transparent.outputs[0], shader_mix.inputs[1])
    l.new(emit.outputs[0], shader_mix.inputs[2])
    l.new(shader_mix.outputs[0], out.inputs[0])

    rest = n.new("ShaderNodeAttribute"); rest.attribute_name = "rest_pos"
    tip = n.new("ShaderNodeAttribute"); tip.attribute_name = "tip"
    tip_f = tip.outputs["Fac"]

    # volume: darker where the surface faces the camera, lighter toward the edges
    lw = n.new("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.5
    base = ramp(n, [(0.0, "000002"), (0.7, "01020c"), (0.94, "040a35")])
    l.new(lw.outputs["Facing"], base.inputs[0])

    # galaxy band: stretched, detailed noise -> deep purple / violet / pink wisps
    stretch = n.new("ShaderNodeVectorMath"); stretch.operation = "MULTIPLY"
    stretch.inputs[1].default_value = (1.0, 1.0, 0.45)
    l.new(rest.outputs["Vector"], stretch.inputs[0])
    neb = n.new("ShaderNodeTexNoise")
    neb.inputs["Scale"].default_value = 3.2
    neb.inputs["Detail"].default_value = 10.0
    neb.inputs["Roughness"].default_value = 0.68
    neb.inputs["Distortion"].default_value = 1.1
    l.new(stretch.outputs[0], neb.inputs["Vector"])
    neb_col = ramp(n, [(0.42, (0, 0, 0, 1)), (0.5, "000a3a"), (0.56, "00157a"), (0.6, "0025a8"), (0.635, "2a2ef0"), (0.655, "884bdd"), (0.668, "c8c4ff"), (0.685, "6a3fd0"), (0.725, "0a1a80"), (0.8, (0, 0, 0, 1))])
    l.new(neb.outputs["Fac"], neb_col.inputs[0])
    # where the band lives: a slow mask, stronger on her front (chest) like the 2D art
    region = n.new("ShaderNodeTexNoise"); region.inputs["Scale"].default_value = 1.4
    l.new(rest.outputs["Vector"], region.inputs["Vector"])
    region_r = ramp(n, [(0.34, (0, 0, 0, 1)), (0.5, (1, 1, 1, 1))])
    l.new(region.outputs["Fac"], region_r.inputs[0])
    sep = n.new("ShaderNodeSeparateXYZ"); l.new(rest.outputs["Vector"], sep.inputs[0])
    front = math_node(n, "MULTIPLY", None, -6.0); l.new(sep.outputs["Y"], front.inputs[0])
    front_c = n.new("ShaderNodeClamp"); l.new(front.outputs[0], front_c.inputs[0])
    front_w = math_node(n, "MULTIPLY_ADD", None, 1.1, 0.35)
    l.new(front_c.outputs[0], front_w.inputs[0]); front_w.inputs[2].default_value = 0.35
    zdist = math_node(n, "SUBTRACT", None, 0.42); l.new(sep.outputs["Z"], zdist.inputs[0])
    zabs = math_node(n, "ABSOLUTE"); l.new(zdist.outputs[0], zabs.inputs[0])
    zmask = n.new("ShaderNodeMapRange")
    zmask.inputs["From Min"].default_value = 0.0; zmask.inputs["From Max"].default_value = 0.2
    zmask.inputs["To Min"].default_value = 1.0; zmask.inputs["To Max"].default_value = 0.0
    l.new(zabs.outputs[0], zmask.inputs["Value"])
    chest = math_node(n, "MULTIPLY"); l.new(front_w.outputs[0], chest.inputs[0]); l.new(zmask.outputs["Result"], chest.inputs[1])
    tailw = n.new("ShaderNodeMapRange")
    tailw.inputs["From Min"].default_value = 0.02; tailw.inputs["From Max"].default_value = 0.5
    tailw.inputs["To Min"].default_value = 0.0; tailw.inputs["To Max"].default_value = 0.5
    tailness = n.new("ShaderNodeAttribute"); tailness.attribute_name = "tailness"
    l.new(tailness.outputs["Fac"], tailw.inputs["Value"])
    where = math_node(n, "MAXIMUM"); l.new(chest.outputs[0], where.inputs[0]); l.new(tailw.outputs["Result"], where.inputs[1])
    band_mask = math_node(n, "MULTIPLY"); l.new(region_r.outputs["Color"], band_mask.inputs[0]); l.new(where.outputs[0], band_mask.inputs[1])
    band = mix_rgb(n, l, "MULTIPLY", 1.0, neb_col.outputs["Color"], (1.8, 1.8, 1.8, 1))
    band_scaled = n.new("ShaderNodeMix"); band_scaled.data_type = "RGBA"; band_scaled.blend_type = "MIX"
    l.new(band_mask.outputs[0], band_scaled.inputs["Factor"])
    band_scaled.inputs["A"].default_value = (0, 0, 0, 1)
    l.new(band, band_scaled.inputs["B"])
    body_col = mix_rgb(n, l, "ADD", 1.0, base.outputs["Color"], band_scaled.outputs["Result"])

    # tail: streaks running along its length (texture coordinate = position along the tail)
    tail_t = tailness.outputs["Fac"]
    flow_vec = n.new("ShaderNodeCombineXYZ")
    along = math_node(n, "MULTIPLY", None, 1.6); l.new(tail_t, along.inputs[0])
    sx = math_node(n, "MULTIPLY", None, 7.0); l.new(sep.outputs["X"], sx.inputs[0])
    sy = math_node(n, "MULTIPLY", None, 7.0); l.new(sep.outputs["Y"], sy.inputs[0])
    l.new(along.outputs[0], flow_vec.inputs[0]); l.new(sx.outputs[0], flow_vec.inputs[1]); l.new(sy.outputs[0], flow_vec.inputs[2])
    flow = n.new("ShaderNodeTexNoise")
    flow.inputs["Scale"].default_value = 1.6
    flow.inputs["Detail"].default_value = 8.0
    flow.inputs["Roughness"].default_value = 0.65
    flow.inputs["Distortion"].default_value = 0.7
    l.new(flow_vec.outputs[0], flow.inputs["Vector"])
    flow_col = ramp(n, [(0.4, (0, 0, 0, 1)), (0.5, "000d4a"), (0.57, "0025a8"), (0.62, "3a34e8"), (0.65, "9a55e6"), (0.675, "d7c8ff"), (0.7, "5a36c8"), (0.76, "061670"), (0.84, (0, 0, 0, 1))])
    l.new(flow.outputs["Fac"], flow_col.inputs[0])
    flow_w = n.new("ShaderNodeMapRange")
    flow_w.inputs["From Min"].default_value = 0.05; flow_w.inputs["From Max"].default_value = 0.9
    flow_w.inputs["To Min"].default_value = 0.0; flow_w.inputs["To Max"].default_value = 1.2
    l.new(tail_t, flow_w.inputs["Value"])
    flow_scaled = n.new("ShaderNodeMix"); flow_scaled.data_type = "RGBA"
    l.new(flow_w.outputs["Result"], flow_scaled.inputs["Factor"])
    flow_scaled.inputs["A"].default_value = (0, 0, 0, 1)
    l.new(flow_col.outputs["Color"], flow_scaled.inputs["B"])
    body_col = mix_rgb(n, l, "ADD", 1.0, body_col, flow_scaled.outputs["Result"])
    # a violet glow building up toward the tip
    glow_w = n.new("ShaderNodeMapRange")
    glow_w.inputs["From Min"].default_value = 0.35; glow_w.inputs["From Max"].default_value = 0.95
    glow_w.inputs["To Min"].default_value = 0.0; glow_w.inputs["To Max"].default_value = 0.55
    l.new(tip_f, glow_w.inputs["Value"])
    tip_glow = n.new("ShaderNodeMix"); tip_glow.data_type = "RGBA"
    l.new(glow_w.outputs["Result"], tip_glow.inputs["Factor"])
    tip_glow.inputs["A"].default_value = (0, 0, 0, 1)
    tip_glow.inputs["B"].default_value = hex_rgb("5a3cd8")
    body_col = mix_rgb(n, l, "ADD", 1.0, body_col, tip_glow.outputs["Result"])

    def star_layer(scale, size, keep_above):
        v = n.new("ShaderNodeTexVoronoi")
        v.inputs["Scale"].default_value = scale
        v.inputs["Randomness"].default_value = 1.0
        l.new(rest.outputs["Vector"], v.inputs["Vector"])
        r = ramp(n, [(0.0, (1, 1, 1, 1)), (size, (0, 0, 0, 1))])
        r.color_ramp.interpolation = "CONSTANT"
        l.new(v.outputs["Distance"], r.inputs[0])
        cs = n.new("ShaderNodeSeparateColor"); l.new(v.outputs["Color"], cs.inputs[0])
        keep = math_node(n, "GREATER_THAN", None, keep_above); l.new(cs.outputs[0], keep.inputs[0])
        mask = math_node(n, "MULTIPLY"); l.new(r.outputs["Color"], mask.inputs[0]); l.new(keep.outputs[0], mask.inputs[1])
        return mask

    small = star_layer(34.0, 0.075, 0.25)
    big = star_layer(11.0, 0.05, 0.75)
    stars = math_node(n, "ADD"); l.new(small.outputs[0], stars.inputs[0]); l.new(big.outputs[0], stars.inputs[1])
    # more stars toward the tail tip, where she turns into stardust
    tip_boost = math_node(n, "MULTIPLY_ADD", None, 5.0, 1.0); l.new(tip_f, tip_boost.inputs[0]); tip_boost.inputs[2].default_value = 1.0
    stars_b = math_node(n, "MULTIPLY"); l.new(stars.outputs[0], stars_b.inputs[0]); l.new(tip_boost.outputs[0], stars_b.inputs[1])
    stars_c = n.new("ShaderNodeClamp"); l.new(stars_b.outputs[0], stars_c.inputs[0])
    with_stars = mix_rgb(n, l, "MIX", stars_c.outputs[0], body_col, hex_rgb("fff6ff"))

    # rim
    rim = ramp(n, [(0.72, (0, 0, 0, 1)), (0.96, (1, 1, 1, 1))])
    l.new(lw.outputs["Facing"], rim.inputs[0])
    eye_zone = n.new("ShaderNodeAttribute"); eye_zone.attribute_name = "eye_zone"
    not_eye = math_node(n, "SUBTRACT", 1.0); l.new(eye_zone.outputs["Fac"], not_eye.inputs[1])
    rim_f = math_node(n, "MULTIPLY"); l.new(rim.outputs["Color"], rim_f.inputs[0]); l.new(not_eye.outputs[0], rim_f.inputs[1])
    final = mix_rgb(n, l, "MIX", rim_f.outputs[0], with_stars, hex_rgb("3d4cf0"))
    final = mix_rgb(n, l, "MIX", eye_zone.outputs["Fac"], final, hex_rgb("000002"))
    l.new(final, emit.inputs["Color"])

    # tail tip: no holes (they exposed the hollow inside). Only the very end fades softly,
    # and back faces are always invisible, so the inside of the mesh never shows.
    crumble = n.new("ShaderNodeTexNoise"); crumble.inputs["Scale"].default_value = 30.0
    l.new(rest.outputs["Vector"], crumble.inputs["Vector"])
    jitter = math_node(n, "MULTIPLY_ADD", None, 0.7, -0.35); l.new(crumble.outputs["Fac"], jitter.inputs[0]); jitter.inputs[2].default_value = -0.35
    d = math_node(n, "ADD"); l.new(tip_f, d.inputs[0]); l.new(jitter.outputs[0], d.inputs[1])
    fade = n.new("ShaderNodeMapRange")
    fade.inputs["From Min"].default_value = 0.62; fade.inputs["From Max"].default_value = 0.98
    fade.inputs["To Min"].default_value = 1.0; fade.inputs["To Max"].default_value = 0.0
    l.new(d.outputs[0], fade.inputs["Value"])
    geo = n.new("ShaderNodeNewGeometry")
    front_face = math_node(n, "SUBTRACT", 1.0); l.new(geo.outputs["Backfacing"], front_face.inputs[1])
    alpha = math_node(n, "MULTIPLY"); l.new(fade.outputs["Result"], alpha.inputs[0]); l.new(front_face.outputs[0], alpha.inputs[1])
    l.new(alpha.outputs[0], shader_mix.inputs[0])
    return m


def emissive(name, color, strength=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    n = m.node_tree.nodes
    n.clear()
    out = n.new("ShaderNodeOutputMaterial")
    e = n.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = hex_rgb(color)
    e.inputs["Strength"].default_value = strength
    m.node_tree.links.new(e.outputs[0], out.inputs[0])
    return m


def parent_to_bone(obj, arm, bone):
    bpy.context.view_layer.update()  # make matrix_world reflect location/scale set just before
    world = obj.matrix_world.copy()
    obj.parent = arm
    obj.parent_type = "BONE"
    obj.parent_bone = bone
    obj.matrix_world = world


def head_frame(arm):
    """Head center, forward (-Y) and up from the rest pose."""
    b = arm.data.bones["tripo::Head_2"]
    head = arm.matrix_world @ b.head_local
    tail = arm.matrix_world @ b.tail_local
    return head, tail


# Sculpted eye centers on the Tripo mesh, found by raycasting from the camera onto the render.
EYE_POINTS = [Vector((0.074, -0.229, 0.676)), Vector((0.246, -0.181, 0.672))]


# Eye outlines traced from the 2D concept art (screen-left and screen-right eye), normalised to
# half-width 1 around the eye's centre; x to the right, z up. Traced by scripts, not by hand.
EYE_OUTLINES = {"left": [[0.8538, 0.0], [0.8214, 0.0809], [0.7848, 0.1561], [0.7449, 0.226], [0.705, 0.292], [0.6633, 0.3545], [0.6224, 0.4159], [0.5788, 0.475], [0.5269, 0.5269], [0.475, 0.5788], [0.4221, 0.6317], [0.3641, 0.6812], [0.3007, 0.726], [0.2308, 0.7609], [0.1585, 0.7971], [0.0817, 0.8297], [0.0, 0.8602], [-0.0871, 0.8847], [-0.1786, 0.898], [-0.2751, 0.9067], [-0.3786, 0.914], [-0.486, 0.9093], [-0.5908, 0.8841], [-0.6914, 0.8425], [-0.7873, 0.7873], [-0.8741, 0.7173], [-0.947, 0.6328], [-0.9819, 0.5248], [-0.9978, 0.4133], [-1.0, 0.3033], [-1.0, 0.1989], [-0.9932, 0.0978], [-0.9606, 0.0], [-0.929, -0.0915], [-0.8944, -0.1779], [-0.8543, -0.2591], [-0.8096, -0.3353], [-0.7607, -0.4066], [-0.7077, -0.4729], [-0.6496, -0.5332], [-0.5866, -0.5866], [-0.5229, -0.6371], [-0.4554, -0.6816], [-0.3864, -0.723], [-0.3164, -0.7639], [-0.2442, -0.8051], [-0.1668, -0.8387], [-0.0849, -0.8621], [-0.0, -0.8807], [0.0883, -0.8968], [0.1818, -0.9138], [0.2773, -0.914], [0.3757, -0.9069], [0.4753, -0.8892], [0.5772, -0.8638], [0.6821, -0.8311], [0.7897, -0.7897], [0.9072, -0.7445], [1.0, -0.6682], [0.9907, -0.5296], [0.9754, -0.404], [0.9524, -0.2889], [0.9276, -0.1845], [0.8888, -0.0875]], "right": [[0.9446, 0.0], [0.975, 0.096], [1.0, 0.1989], [1.0, 0.3033], [0.9943, 0.4119], [0.9818, 0.5248], [0.9453, 0.6316], [0.88, 0.7222], [0.7968, 0.7968], [0.6968, 0.8491], [0.5917, 0.8856], [0.4859, 0.909], [0.3801, 0.9175], [0.2783, 0.9175], [0.1825, 0.9175], [0.0887, 0.9002], [0.0, 0.8729], [-0.0832, 0.8451], [-0.1613, 0.8111], [-0.2349, 0.7743], [-0.3006, 0.7256], [-0.3621, 0.6774], [-0.4211, 0.6302], [-0.474, 0.5776], [-0.5258, 0.5258], [-0.5763, 0.4729], [-0.6221, 0.4157], [-0.6663, 0.3562], [-0.7082, 0.2934], [-0.7518, 0.228], [-0.7923, 0.1576], [-0.8302, 0.0818], [-0.866, 0.0], [-0.8954, -0.0882], [-0.9249, -0.184], [-0.951, -0.2885], [-0.98, -0.4059], [-1.0, -0.5345], [-0.9583, -0.6403], [-0.8514, -0.6987], [-0.7526, -0.7526], [-0.6594, -0.8034], [-0.5696, -0.8524], [-0.4785, -0.8952], [-0.3801, -0.9175], [-0.2783, -0.9175], [-0.1825, -0.9175], [-0.0904, -0.9175], [-0.0, -0.9175], [0.0889, -0.903], [0.1744, -0.8766], [0.2575, -0.8489], [0.3357, -0.8105], [0.4057, -0.7589], [0.4724, -0.707], [0.5382, -0.6558], [0.5979, -0.5979], [0.6568, -0.539], [0.7169, -0.479], [0.7587, -0.4055], [0.7939, -0.3288], [0.8293, -0.2516], [0.8657, -0.1722], [0.9038, -0.089]]}


EYE_NIGHT = []  # material value nodes to switch day / night pupils
EYE_CTRL = {}   # "pupil" / "lid" / "lid_angle" -> value nodes, one per eye


def outline_mesh(name, outline, scale, bulge=0.1, rings=24):
    """A flat eye shape from a traced outline (list of (x, z) at half-width 1), slightly domed toward -Y."""
    verts = [(0.0, -bulge * scale, 0.0)]
    faces = []
    m = len(outline)
    for r in range(1, rings + 1):
        f = r / rings
        for x, z in outline:
            verts.append((x * scale * f, -bulge * scale * (1 - f * f), z * scale * f))
    for k in range(m):
        faces.append((0, 1 + k, 1 + (k + 1) % m))
    for r in range(rings - 1):
        o0, o1 = 1 + r * m, 1 + (r + 1) * m
        for k in range(m):
            k2 = (k + 1) % m
            faces.append((o0 + k, o1 + k, o1 + k2, o0 + k2))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    edge = me.attributes.new("edge", "FLOAT", "POINT")
    edge.data[0].value = 0.0
    for r in range(1, rings + 1):
        for k in range(m):
            edge.data[1 + (r - 1) * m + k].value = r / rings
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    for poly in me.polygons:
        poly.use_smooth = True
    return obj


def eye_material(name, a, b, seed, mirror=1):
    """Starlit iris filling the whole eye shape, a lens-shaped slit pupil:
    dark in the day, glowing cream-gold at night (EYE_NIGHT value: 0 day, 1 night)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    n, l = m.node_tree.nodes, m.node_tree.links
    n.clear()
    out = n.new("ShaderNodeOutputMaterial")
    emit = n.new("ShaderNodeEmission")
    l.new(emit.outputs[0], out.inputs[0])
    tc = n.new("ShaderNodeTexCoord")
    sep = n.new("ShaderNodeSeparateXYZ"); l.new(tc.outputs["Object"], sep.inputs[0])
    u = math_node(n, "DIVIDE", None, a * mirror); l.new(sep.outputs["X"], u.inputs[0])  # -1 inner .. +1 outer
    v = math_node(n, "DIVIDE", None, b); l.new(sep.outputs["Z"], v.inputs[0])      # -0.8..1 up

    # iris: deep blue at the top (under the lid), electric blue in the middle, violet low down
    vgrad = ramp(n, [(0.0, "b8e4ff"), (0.08, "6cb4ff"), (0.22, "4472ff"), (0.48, "2c3ce8"), (0.78, "161ea8"), (1.0, "060a50")])
    vmap = n.new("ShaderNodeMapRange")
    vmap.inputs["From Min"].default_value = -1.0; vmap.inputs["From Max"].default_value = 1.0
    l.new(v.outputs[0], vmap.inputs["Value"]); l.new(vmap.outputs["Result"], vgrad.inputs[0])
    # nebula swirls inside the iris
    neb = n.new("ShaderNodeTexNoise")
    neb.noise_dimensions = "4D"; neb.inputs["W"].default_value = seed
    neb.inputs["Scale"].default_value = 42.0; neb.inputs["Detail"].default_value = 6.0; neb.inputs["Distortion"].default_value = 0.9
    l.new(tc.outputs["Object"], neb.inputs["Vector"])
    neb_c = ramp(n, [(0.5, (0, 0, 0, 1)), (0.6, "1a1a80"), (0.68, "7a50e8"), (0.76, "c8a0ff"), (0.84, "f0f0ff")])
    l.new(neb.outputs["Fac"], neb_c.inputs[0])
    iris = mix_rgb(n, l, "ADD", 0.9, vgrad.outputs["Color"], neb_c.outputs["Color"])
    # tiny stars in the iris
    vor = n.new("ShaderNodeTexVoronoi"); vor.inputs["Scale"].default_value = 95.0
    l.new(tc.outputs["Object"], vor.inputs["Vector"])
    st = ramp(n, [(0.0, (1, 1, 1, 1)), (0.13, (0, 0, 0, 1))]); st.color_ramp.interpolation = "CONSTANT"
    l.new(vor.outputs["Distance"], st.inputs[0])
    vsep = n.new("ShaderNodeSeparateColor"); l.new(vor.outputs["Color"], vsep.inputs[0])
    keep = math_node(n, "GREATER_THAN", None, 0.45); l.new(vsep.outputs[0], keep.inputs[0])
    stars = math_node(n, "MULTIPLY"); l.new(st.outputs["Color"], stars.inputs[0]); l.new(keep.outputs[0], stars.inputs[1])
    iris = mix_rgb(n, l, "MIX", stars.outputs[0], iris, hex_rgb("e6f6ff"))
    # violet-pink on the outer, lower part of the iris
    outer_w = n.new("ShaderNodeMapRange")
    outer_w.inputs["From Min"].default_value = 0.0; outer_w.inputs["From Max"].default_value = 0.75
    l.new(u.outputs[0], outer_w.inputs["Value"])
    low_w = n.new("ShaderNodeMapRange")
    low_w.inputs["From Min"].default_value = 0.4; low_w.inputs["From Max"].default_value = -0.5
    l.new(v.outputs[0], low_w.inputs["Value"])
    vio_w = math_node(n, "MULTIPLY"); l.new(outer_w.outputs["Result"], vio_w.inputs[0]); l.new(low_w.outputs["Result"], vio_w.inputs[1])
    vio_w2 = math_node(n, "MULTIPLY", None, 1.0); l.new(vio_w.outputs[0], vio_w2.inputs[0])
    iris = mix_rgb(n, l, "MIX", vio_w2.outputs[0], iris, hex_rgb("c07cf2"))
    # the blue glow behind the base of the pupil
    gp = n.new("ShaderNodeCombineXYZ"); l.new(u.outputs[0], gp.inputs[0])
    vg = math_node(n, "ADD", None, 0.4); l.new(v.outputs[0], vg.inputs[0]); l.new(vg.outputs[0], gp.inputs[1])
    gl = n.new("ShaderNodeVectorMath"); gl.operation = "LENGTH"; l.new(gp.outputs[0], gl.inputs[0])
    glow = ramp(n, [(0.0, "3a6cff"), (0.3, "1530b0"), (0.6, (0, 0, 0, 1))])
    l.new(gl.outputs["Value"], glow.inputs[0])
    iris = mix_rgb(n, l, "ADD", 1.0, iris, glow.outputs["Color"])

    # pupil: an almond (lens) shape, pointed at top and bottom, ~1/5 of the eye's width at its widest.
    # v is re-centred so the pupil spans the iris (which reaches 1.0 up and -0.8 down).
    vc = math_node(n, "SUBTRACT", None, 0.0); l.new(v.outputs[0], vc.inputs[0])
    vn = math_node(n, "DIVIDE", None, 0.96); l.new(vc.outputs[0], vn.inputs[0])
    vv = math_node(n, "MULTIPLY"); l.new(vn.outputs[0], vv.inputs[0]); l.new(vn.outputs[0], vv.inputs[1])
    one_minus = math_node(n, "SUBTRACT", 1.0); l.new(vv.outputs[0], one_minus.inputs[1])
    one_minus_c = n.new("ShaderNodeClamp"); l.new(one_minus.outputs[0], one_minus_c.inputs[0])
    pupil_w = n.new("ShaderNodeValue"); pupil_w.outputs[0].default_value = 0.2
    EYE_CTRL.setdefault("pupil", []).append(pupil_w)
    width = math_node(n, "MULTIPLY"); l.new(one_minus_c.outputs[0], width.inputs[0]); l.new(pupil_w.outputs[0], width.inputs[1])
    au = math_node(n, "ABSOLUTE"); l.new(u.outputs[0], au.inputs[0])
    d = math_node(n, "SUBTRACT"); l.new(width.outputs[0], d.inputs[0]); l.new(au.outputs[0], d.inputs[1])
    slit = n.new("ShaderNodeMapRange")
    slit.inputs["From Min"].default_value = -0.012; slit.inputs["From Max"].default_value = 0.012
    l.new(d.outputs[0], slit.inputs["Value"])

    night = n.new("ShaderNodeValue"); night.outputs[0].default_value = 0.0
    EYE_NIGHT.append(night)
    # night pupil: warm cream core fading to amber at its edges, like the 2D night eyes
    core = n.new("ShaderNodeMapRange")
    core.inputs["From Min"].default_value = 0.0; core.inputs["From Max"].default_value = 0.07
    l.new(d.outputs[0], core.inputs["Value"])
    gold = mix_rgb(n, l, "MIX", core.outputs["Result"], (0.62, 0.32, 0.07, 1), (1.25, 1.0, 0.68, 1))
    pupil = mix_rgb(n, l, "MIX", night.outputs[0], hex_rgb("01010a"), gold)  # day dark / night gold
    col = mix_rgb(n, l, "MIX", slit.outputs["Result"], iris, pupil)
    # a thin dark-navy edge: darken where the shape's radial coordinate approaches the outline
    edge_g = n.new("ShaderNodeAttribute"); edge_g.attribute_name = "edge"
    edge_r = ramp(n, [(0.9, (0, 0, 0, 1)), (0.925, (1, 1, 1, 1))])
    l.new(edge_g.outputs["Fac"], edge_r.inputs[0])
    col = mix_rgb(n, l, "MIX", edge_r.outputs["Color"], col, hex_rgb("0a1060"))

    lid = n.new("ShaderNodeValue"); lid.outputs[0].default_value = 0.0
    lid_angle = n.new("ShaderNodeValue"); lid_angle.outputs[0].default_value = 0.0
    EYE_CTRL.setdefault("lid", []).append(lid)
    EYE_CTRL.setdefault("lid_angle", []).append(lid_angle)
    # lid edge height: 1.05 (open) down to -0.55 (closed), tilted by the angle toward the inner corner (u < 0)
    lid_drop = math_node(n, "MULTIPLY", None, 1.4); l.new(lid.outputs[0], lid_drop.inputs[0])
    lid_h = math_node(n, "SUBTRACT", 1.05); l.new(lid_drop.outputs[0], lid_h.inputs[1])
    tilt = math_node(n, "MULTIPLY"); l.new(lid_angle.outputs[0], tilt.inputs[0]); l.new(u.outputs[0], tilt.inputs[1])
    # the lid line bends as it closes: ends a little higher than the middle (a soft closed-eye arc)
    uu = math_node(n, "MULTIPLY"); l.new(u.outputs[0], uu.inputs[0]); l.new(u.outputs[0], uu.inputs[1])
    bend_k = math_node(n, "MULTIPLY", None, 0.32); l.new(lid.outputs[0], bend_k.inputs[0])
    bend = math_node(n, "MULTIPLY"); l.new(uu.outputs[0], bend.inputs[0]); l.new(bend_k.outputs[0], bend.inputs[1])
    lid_edge0 = math_node(n, "ADD"); l.new(lid_h.outputs[0], lid_edge0.inputs[0]); l.new(tilt.outputs[0], lid_edge0.inputs[1])
    lid_edge = math_node(n, "ADD"); l.new(lid_edge0.outputs[0], lid_edge.inputs[0]); l.new(bend.outputs[0], lid_edge.inputs[1])
    above = math_node(n, "SUBTRACT"); l.new(v.outputs[0], above.inputs[0]); l.new(lid_edge.outputs[0], above.inputs[1])
    covered = n.new("ShaderNodeMapRange")
    covered.inputs["From Min"].default_value = -0.02; covered.inputs["From Max"].default_value = 0.02
    l.new(above.outputs[0], covered.inputs["Value"])
    shut = math_node(n, "GREATER_THAN", None, 0.97); l.new(lid.outputs[0], shut.inputs[0])
    hidden = math_node(n, "MAXIMUM"); l.new(covered.outputs["Result"], hidden.inputs[0]); l.new(shut.outputs[0], hidden.inputs[1])
    col = mix_rgb(n, l, "MIX", hidden.outputs[0], col, hex_rgb("000002"))
    # the lid's edge: a thin lavender line (only once the lid is actually down a little)
    aabs = math_node(n, "ABSOLUTE"); l.new(above.outputs[0], aabs.inputs[0])
    line = n.new("ShaderNodeMapRange")
    line.inputs["From Min"].default_value = 0.05; line.inputs["From Max"].default_value = 0.018
    l.new(aabs.outputs[0], line.inputs["Value"])
    lid_on = math_node(n, "GREATER_THAN", None, 0.04); l.new(lid.outputs[0], lid_on.inputs[0])
    inside = n.new("ShaderNodeMapRange")
    inside.inputs["From Min"].default_value = 0.97; inside.inputs["From Max"].default_value = 0.9
    l.new(edge_g.outputs["Fac"], inside.inputs["Value"])
    line_w = math_node(n, "MULTIPLY"); l.new(line.outputs["Result"], line_w.inputs[0]); l.new(lid_on.outputs[0], line_w.inputs[1])
    line_w2 = math_node(n, "MULTIPLY"); l.new(line_w.outputs[0], line_w2.inputs[0]); l.new(inside.outputs["Result"], line_w2.inputs[1])
    col = mix_rgb(n, l, "MIX", line_w2.outputs[0], col, hex_rgb("6b78f0"))
    l.new(col, emit.inputs["Color"])
    return m


def add_eyes(arm, body):
    """Each eye is one flat mesh in the shape traced from the 2D art (EYE_OUTLINES), with the
    starlit iris material. It faces between the face's front and the camera, so it reads from
    the camera instead of lying flat along the side of the head."""
    from mathutils import Quaternion
    inv = body.matrix_world.inverted()
    a, b = 0.045, 0.041
    hits = []
    for p in EYE_POINTS:
        ok, loc, nor, _ = body.closest_point_on_mesh(inv @ p)
        hits.append((body.matrix_world @ loc, (body.matrix_world.to_3x3() @ nor).normalized()))
    front = (hits[0][1] + hits[1][1]).normalized()
    for i, (loc, nor) in enumerate(hits):
        cam = bpy.context.scene.camera
        to_cam = (cam.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()
        d = (front * 0.45 + nor * 0.15 + to_cam * 0.4).normalized()
        outer = 1 if (loc - hits[1 - i][0]).x > 0 else -1
        rot = d.to_track_quat("-Y", "Z").to_euler()
        outline = EYE_OUTLINES["right" if outer > 0 else "left"]
        # In an orthographic view, moving along the view direction doesn't move the eye on screen;
        # it only lifts it out of the head surface, which was hiding part of the near eye.
        loc = loc + to_cam * 0.025
        iris = outline_mesh(f"Eye{i}", outline, a)
        iris.data.materials.append(eye_material(f"EyeMat{i}", a, b, 3.0 + 5 * i, outer))
        iris.location = loc + d * 0.0195
        iris.rotation_euler = rot
        parent_to_bone(iris, arm, "tripo::Head_2")


def set_eyes(lid=0.0, lid_angle=0.0, pupil=0.2):
    for node in EYE_CTRL.get("lid", []):
        node.outputs[0].default_value = lid
    for node in EYE_CTRL.get("lid_angle", []):
        node.outputs[0].default_value = lid_angle
    for node in EYE_CTRL.get("pupil", []):
        node.outputs[0].default_value = pupil


def set_night_eyes(on):
    for node in EYE_NIGHT:
        node.outputs[0].default_value = 1.0 if on else 0.0


def sparkle_mesh(name, r):
    """A concave 4-point sparkle (long cardinal points, short diagonal ones), flat in the XZ plane."""
    verts = [(0.0, 0.0, 0.0)]
    for k in range(16):
        ang = math.pi / 2 + k * math.pi / 8
        if k % 4 == 0:
            rr = r
        elif k % 4 == 2:
            rr = r * 0.32
        else:
            rr = r * 0.09
        verts.append((rr * math.cos(ang), 0.0, rr * math.sin(ang)))
    faces = [(0, i + 1, (i + 1) % 16 + 1) for i in range(16)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    return obj


def disc_mesh(name, r, segments=32):
    verts = [(0.0, 0.0, 0.0)] + [(r * math.cos(2 * math.pi * k / segments), 0.0, r * math.sin(2 * math.pi * k / segments)) for k in range(segments)]
    faces = [(0, k + 1, (k + 1) % segments + 1) for k in range(segments)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    return obj


def radial_material(name, radius, stops, strength, alpha_stops=None):
    """Emission colored by distance from the object's center: hot core, colored points, optional fade-out."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    n, l = m.node_tree.nodes, m.node_tree.links
    n.clear()
    out = n.new("ShaderNodeOutputMaterial")
    emit = n.new("ShaderNodeEmission"); emit.inputs["Strength"].default_value = strength
    tc = n.new("ShaderNodeTexCoord")
    length = n.new("ShaderNodeVectorMath"); length.operation = "LENGTH"
    l.new(tc.outputs["Object"], length.inputs[0])
    norm = math_node(n, "DIVIDE", None, radius); l.new(length.outputs["Value"], norm.inputs[0])
    col = ramp(n, stops); l.new(norm.outputs[0], col.inputs[0])
    l.new(col.outputs["Color"], emit.inputs["Color"])
    if alpha_stops is None:
        l.new(emit.outputs[0], out.inputs[0])
        return m
    a = ramp(n, alpha_stops); l.new(norm.outputs[0], a.inputs[0])
    tr = n.new("ShaderNodeBsdfTransparent")
    mix = n.new("ShaderNodeMixShader")
    l.new(a.outputs["Color"], mix.inputs[0])
    l.new(tr.outputs[0], mix.inputs[1]); l.new(emit.outputs[0], mix.inputs[2])
    l.new(mix.outputs[0], out.inputs[0])
    return m


def face_camera(obj):
    c = obj.constraints.new("TRACK_TO")
    c.target = bpy.context.scene.camera
    c.track_axis = "TRACK_NEGATIVE_Y"
    c.up_axis = "UP_Z"


CROWN = []      # (object, base scale, phase) for twinkling
CROWN_GLOW = []  # (emission node, base strength) for dimming the crown while she sleeps


def set_crown_glow(k):
    for node, base in CROWN_GLOW:
        node.inputs["Strength"].default_value = base * k
STARDUST = []   # (object, start offset, direction, size, phase) for drifting


def add_crown(arm):
    head, tail = head_frame(arm)
    top = Vector((head.x, head.y - 0.02, tail.z + 0.17))
    for name, dx, dz, r, phase in (("CrownMid", 0, 0.035, 0.075, 0.0), ("CrownL", -0.095, 0, 0.042, 0.33), ("CrownR", 0.095, 0, 0.042, 0.66)):
        star = sparkle_mesh(name, r)
        star.data.materials.append(radial_material(
            name + "Mat", r,
            [(0.0, "ffffff"), (0.12, "fff1cf"), (0.45, "f3c873"), (1.0, "c9893a")], 2.2))
        halo = disc_mesh(name + "Halo", r * 1.25)
        halo.data.materials.append(radial_material(
            name + "HaloMat", r * 1.25,
            [(0.0, "fff1cf"), (1.0, "f3c873")], 1.2,
            alpha_stops=[(0.0, (0.55, 0.55, 0.55, 1)), (0.35, (0.18, 0.18, 0.18, 1)), (1.0, (0, 0, 0, 1))]))
        for o in (star, halo):
            o.location = top + Vector((dx, 0, dz))
            parent_to_bone(o, arm, "tripo::Head_2")
            face_camera(o)
        halo.location.y += 0.002  # just behind the star
        for o in (star, halo):
            mat = o.data.materials[0]
            em = next(nd for nd in mat.node_tree.nodes if nd.type == "EMISSION")
            CROWN_GLOW.append((em, em.inputs["Strength"].default_value))
        CROWN.append((star, 1.0, phase))
        CROWN.append((halo, 1.0, phase))


def add_stardust(arm, seed=7):
    """The tail tip breaking up into a cloud: many tiny star dots, some medium sparkles,
    a few big glowing ones, and small purple nebula orbs, all drifting off and fading on a loop."""
    import random
    rnd = random.Random(seed)
    bone = arm.data.bones["bone_35"]
    tip = arm.matrix_world @ bone.tail_local
    base = arm.matrix_world @ (arm.data.bones["tripo::Tail_7"].head_local)
    along = (tip - base).normalized()
    white = radial_material("DustMat", 0.02, [(0.0, "ffffff"), (0.3, "eceaff"), (1.0, "a6a8ff")], 2.4)
    halo_mat = radial_material("DustHaloMat", 1.0, [(0.0, "dcdcff"), (1.0, "8d8fff")], 1.0,
                               alpha_stops=[(0.0, (0.5, 0.5, 0.5, 1)), (0.3, (0.14, 0.14, 0.14, 1)), (1.0, (0, 0, 0, 1))])
    orb_mat = radial_material("OrbMat", 1.0, [(0.0, "8a6cff"), (0.6, "4a37b8"), (1.0, "241a6a")], 1.3,
                              alpha_stops=[(0.0, (1, 1, 1, 1)), (0.7, (0.85, 0.85, 0.85, 1)), (1.0, (0, 0, 0, 1))])

    def spawn(name, obj, radius_spread, rise):
        start = tip - along * rnd.uniform(0.0, 0.12) + Vector((rnd.uniform(-1, 1) * radius_spread, rnd.uniform(-0.03, 0.03), rnd.uniform(-0.6, 1) * radius_spread))
        direction = (along * rnd.uniform(0.3, 1.0) + Vector((rnd.uniform(-1, 0.6), rnd.uniform(-0.3, 0.3), rnd.uniform(0.0, 1.0) * rise))).normalized()
        obj.location = start
        parent_to_bone(obj, arm, "bone_35")
        face_camera(obj)
        STARDUST.append((obj, obj.location.copy(), direction, 1.0, rnd.random()))

    # one big star sitting on the tail tip, like the 2D art (the tail ends *in* a star)
    big_r = 0.07
    tip_star = sparkle_mesh("TipStar", big_r)
    tip_star.data.materials.append(radial_material(
        "TipStarMat", big_r, [(0.0, "ffffff"), (0.15, "f4f2ff"), (0.5, "c8c8ff"), (1.0, "8f92ff")], 2.6))
    tip_halo = disc_mesh("TipStarHalo", big_r * 1.3)
    tip_halo.data.materials.append(radial_material(
        "TipHaloMat", big_r * 1.3, [(0.0, "e6e6ff"), (1.0, "8f92ff")], 1.2,
        alpha_stops=[(0.0, (0.6, 0.6, 0.6, 1)), (0.35, (0.16, 0.16, 0.16, 1)), (1.0, (0, 0, 0, 1))]))
    for o in (tip_star, tip_halo):
        o.location = tip - along * 0.02
        parent_to_bone(o, arm, "bone_35")
        face_camera(o)
    tip_halo.location.y += 0.002
    CROWN.append((tip_star, 1.0, 0.5))
    CROWN.append((tip_halo, 1.0, 0.5))

    for i in range(55):  # tiny dots
        o = sparkle_mesh(f"DustS{i}", rnd.uniform(0.004, 0.008))
        o.data.materials.append(white)
        spawn(o.name, o, 0.13, 1.0)
    for i in range(9):  # medium sparkles
        o = sparkle_mesh(f"DustM{i}", rnd.uniform(0.012, 0.02))
        o.data.materials.append(white)
        spawn(o.name, o, 0.1, 0.8)
    for i in range(3):  # big glowing sparkles
        r = rnd.uniform(0.028, 0.04)
        o = sparkle_mesh(f"DustB{i}", r)
        o.data.materials.append(white)
        h = disc_mesh(f"DustBHalo{i}", r * 1.2)
        h.data.materials.append(halo_mat)
        h.scale = (r * 1.2, r * 1.2, r * 1.2)
        h.data.transform(__import__("mathutils").Matrix.Scale(1 / (r * 1.2), 4))
        spawn(o.name, o, 0.08, 0.6)
        h.location = STARDUST[-1][1] + Vector((0, 0.001, 0))
        parent_to_bone(h, arm, "bone_35")
        face_camera(h)
        STARDUST.append((h, STARDUST[-1][1].copy(), STARDUST[-1][2], 1.0, STARDUST[-1][4]))
    for i in range(6):  # purple nebula orbs, like the blobs breaking off in the 2D art
        r = rnd.uniform(0.007, 0.016)
        o = disc_mesh(f"DustOrb{i}", 1.0)
        o.data.materials.append(orb_mat)
        o.data.transform(__import__("mathutils").Matrix.Scale(r, 4))
        o.data.update()
        # radial material uses object-space distance: keep geometry radius 1 instead
        o.data.transform(__import__("mathutils").Matrix.Scale(1 / r, 4))
        o.scale = (r, r, r)
        spawn(o.name, o, 0.06, 0.5)


WISPS = []  # (noise node, base W, phase)


def wisp_material(name, seed):
    """A soft cloud of nebula: noise shaped by a radial falloff; color from deep blue to violet."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    n, l = m.node_tree.nodes, m.node_tree.links
    n.clear()
    out = n.new("ShaderNodeOutputMaterial")
    tc = n.new("ShaderNodeTexCoord")
    noise = n.new("ShaderNodeTexNoise")
    noise.noise_dimensions = "4D"
    noise.inputs["W"].default_value = seed
    noise.inputs["Scale"].default_value = 2.2
    noise.inputs["Detail"].default_value = 6.0
    noise.inputs["Distortion"].default_value = 0.8
    l.new(tc.outputs["Object"], noise.inputs["Vector"])
    length = n.new("ShaderNodeVectorMath"); length.operation = "LENGTH"
    l.new(tc.outputs["Object"], length.inputs[0])
    falloff = ramp(n, [(0.0, (1, 1, 1, 1)), (0.55, (0.6, 0.6, 0.6, 1)), (1.0, (0, 0, 0, 1))])
    l.new(length.outputs["Value"], falloff.inputs[0])
    dens = ramp(n, [(0.45, (0, 0, 0, 1)), (0.7, (1, 1, 1, 1))])
    l.new(noise.outputs["Fac"], dens.inputs[0])
    a = math_node(n, "MULTIPLY"); l.new(falloff.outputs["Color"], a.inputs[0]); l.new(dens.outputs["Color"], a.inputs[1])
    a2 = math_node(n, "MULTIPLY", None, 0.75); l.new(a.outputs[0], a2.inputs[0])
    col = ramp(n, [(0.45, "000c55"), (0.58, "0025a8"), (0.66, "3b34e0"), (0.72, "8a4ee0"), (0.8, "c0b0ff")])
    l.new(noise.outputs["Fac"], col.inputs[0])
    emit = n.new("ShaderNodeEmission"); emit.inputs["Strength"].default_value = 1.0
    l.new(col.outputs["Color"], emit.inputs["Color"])
    tr = n.new("ShaderNodeBsdfTransparent")
    mix = n.new("ShaderNodeMixShader")
    l.new(a2.outputs[0], mix.inputs[0]); l.new(tr.outputs[0], mix.inputs[1]); l.new(emit.outputs[0], mix.inputs[2])
    l.new(mix.outputs[0], out.inputs[0])
    return m, noise


def add_wisps(arm, count=6, seed=11):
    """Nebula clouds trailing off the tail tip: the tail dissolving into the night, not just stars."""
    import random
    rnd = random.Random(seed)
    bone = arm.data.bones["bone_35"]
    tip = arm.matrix_world @ bone.tail_local
    base = arm.matrix_world @ arm.data.bones["tripo::Tail_7"].head_local
    along = (tip - base).normalized()
    for i in range(count):
        r = rnd.uniform(0.05, 0.1)
        o = disc_mesh(f"Wisp{i}", 1.0, segments=40)
        mat, noise = wisp_material(f"WispMat{i}", rnd.uniform(0, 20))
        o.data.materials.append(mat)
        o.scale = (r, r, r)
        o.location = tip + along * rnd.uniform(-0.05, 0.06) + Vector((rnd.uniform(-0.09, 0.03), 0.01 + 0.004 * i, rnd.uniform(-0.03, 0.08)))
        parent_to_bone(o, arm, "bone_35")
        face_camera(o)
        WISPS.append((noise, noise.inputs["W"].default_value, rnd.random()))


FOOD = []  # (object, start, end, phase)


MOUTH = []


def add_food(arm, body, count=18, seed=5):
    """Starlight she eats: little sparkles rising from below and drifting into her mouth."""
    import random
    rnd = random.Random(seed)
    head = arm.matrix_world @ arm.data.bones["tripo::Head_1"].head_local
    eyes = EYE_POINTS
    mouth = (eyes[0] + eyes[1]) / 2 + Vector((0.0, -0.05, -0.1))
    empty = bpy.data.objects.new("Mouth", None)
    bpy.context.collection.objects.link(empty)
    empty.location = mouth
    parent_to_bone(empty, arm, "tripo::Head_2")
    MOUTH.append(empty)
    mat = radial_material("FoodMat", 0.02, [(0.0, "ffffff"), (0.3, "fff1cf"), (1.0, "f3c873")], 2.2)
    for i in range(count):
        r = rnd.uniform(0.012, 0.022)
        o = sparkle_mesh(f"Food{i}", r)
        o.data.materials.append(mat)
        start = mouth + Vector((rnd.uniform(-0.1, 0.07), rnd.uniform(-0.1, -0.04), rnd.uniform(-0.26, -0.14)))
        o.location = start
        face_camera(o)
        o.hide_render = True
        FOOD.append((o, start, mouth, rnd.random()))


def animate_food(t, on, cycles=3):
    end = MOUTH[0].matrix_world.translation.copy()
    for o, start, _end, phase in FOOD:
        o.hide_render = not on
        if not on:
            continue
        p = (cycles * t + phase) % 1.0
        ease = p * p * (3 - 2 * p)
        o.location = start.lerp(end, ease) + Vector((0.0, 0.0, 0.03 * math.sin(math.pi * p)))
        k = math.sin(math.pi * min(1.0, p * 1.15)) ** 0.8 if p < 0.87 else 0.0
        o.scale = (k, k, k)


TOY = []  # (sparkle, halo)


def add_toy(arm):
    """A little star toy she plays with, floating in front of her."""
    mat = radial_material("ToyMat", 0.03, [(0.0, "ffffff"), (0.2, "f4f2ff"), (0.55, "a6c6ff"), (1.0, "6a7cff")], 2.6)
    halo_mat = radial_material("ToyHaloMat", 0.04, [(0.0, "dde6ff"), (1.0, "6a7cff")], 1.2,
                               alpha_stops=[(0.0, (0.6, 0.6, 0.6, 1)), (0.35, (0.15, 0.15, 0.15, 1)), (1.0, (0, 0, 0, 1))])
    star = sparkle_mesh("ToyStar", 0.03); star.data.materials.append(mat)
    halo = disc_mesh("ToyHalo", 0.04); halo.data.materials.append(halo_mat)
    for o in (star, halo):
        face_camera(o)
        o.hide_render = True
    TOY.append((star, halo))


def place_toy(pos, on):
    for star, halo in TOY:
        star.hide_render = halo.hide_render = not on
        star.location = pos
        halo.location = pos + Vector((0, 0.002, 0))


BODY_SPARKLES = []  # (object, phase)


def add_body_sparkles(arm, body, count=10, seed=3):
    """A few 4-point sparkles sitting on her visible surface, like the white stars in the 2D art."""
    import random
    rnd = random.Random(seed)
    cam = bpy.context.scene.camera
    view = (cam.matrix_world.to_3x3() @ Vector((0, 0, -1))).normalized()
    groups = {g.index: g.name for g in body.vertex_groups}
    tip = body.data.attributes["tip"]
    verts = body.data.vertices
    mw = body.matrix_world
    mat = radial_material("BodySparkleMat", 0.02, [(0.0, "ffffff"), (0.35, "f4f0ff"), (1.0, "b7b5ff")], 2.2)
    placed = []
    tries = 0
    while len(placed) < count and tries < 20000:
        tries += 1
        v = verts[rnd.randrange(len(verts))]
        nrm = (mw.to_3x3() @ v.normal).normalized()
        co = mw @ v.co
        if nrm.dot(view) > -0.55 or tip.data[v.index].value > 0.3 or co.z > 0.62:
            continue
        if any((co - p).length < 0.09 for p in placed):
            continue
        g = max(v.groups, key=lambda x: x.weight, default=None)
        if g is None:
            continue
        r = rnd.uniform(0.012, 0.024)
        sp = sparkle_mesh(f"Sparkle{len(placed)}", r)
        sp.data.materials.append(mat)
        sp.location = co + nrm * 0.006
        parent_to_bone(sp, arm, groups[g.group])
        face_camera(sp)
        BODY_SPARKLES.append((sp, rnd.random()))
        placed.append(co)


def animate_extras(t, cycles_dust=2, cycles_twinkle=2):
    """Pose the crown twinkle and the stardust drift for loop phase t in [0, 1)."""
    for obj, base, phase in CROWN:
        k = 1.0 + 0.07 * math.sin(2 * math.pi * (cycles_twinkle * t + phase))
        obj.scale = (k, k, k)
    for noise, w0, phase in WISPS:
        noise.inputs["W"].default_value = w0 + 0.35 * math.sin(2 * math.pi * (t + phase))
    for obj, phase in BODY_SPARKLES:
        k = 0.75 + 0.25 * math.sin(2 * math.pi * (cycles_twinkle * t + phase))
        obj.scale = (k, k, k)
    for obj, start, direction, size, phase in STARDUST:
        if "base_scale" not in obj:
            obj["base_scale"] = obj.scale[0]
        p = (cycles_dust * t + phase) % 1.0
        obj.location = start + direction * (0.2 * p)
        k = obj["base_scale"] * math.sin(math.pi * p) ** 1.5
        obj.scale = (k, k, k)


def add_camera(body, yaw_deg=-18):
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("Cam", cam_data)
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    # frame the body's bounding box from the front, slightly turned (three-quarter-ish)
    corners = [body.matrix_world @ Vector(c) for c in body.bound_box]
    center = sum(corners, Vector()) / 8
    size_z = max(c.z for c in corners) - min(c.z for c in corners)
    cam_data.ortho_scale = size_z * 1.28
    yaw = math.radians(yaw_deg)
    dist = 3.0
    cam.location = center + Vector((math.sin(yaw) * dist, -math.cos(yaw) * dist, 0.25 * dist * 0.1))
    direction = center - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    cam.location.z += size_z * 0.06


def add_glow_compositor(strength=0.9, threshold=0.85, size=0.55):
    """Blender 5 compositor: render layer -> glare (bloom) -> group output, so bright parts glow."""
    sc = bpy.context.scene
    ng = bpy.data.node_groups.new("NyxComp", "CompositorNodeTree")
    ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    nodes, links = ng.nodes, ng.links
    rl = nodes.new("CompositorNodeRLayers")
    glare = nodes.new("CompositorNodeGlare")
    out = nodes.new("NodeGroupOutput")
    for key, val in (("Type", "Bloom"), ("Quality", "High")):
        try:
            glare.inputs[key].default_value = val
        except Exception as exc:
            print("glare", key, "skipped:", exc)
    glare.inputs["Threshold"].default_value = threshold
    glare.inputs["Strength"].default_value = strength
    glare.inputs["Size"].default_value = size
    links.new(rl.outputs["Image"], glare.inputs["Image"])
    print("glare type:", glare.inputs["Type"].default_value)
    # The glow lands on fully transparent pixels; give them alpha = their brightness,
    # otherwise the glow disappears when the PNG is drawn over anything.
    sep = nodes.new("CompositorNodeSeparateColor")
    links.new(glare.outputs[0], sep.inputs[0])
    m1 = nodes.new("ShaderNodeMath"); m1.operation = "MAXIMUM"
    m2 = nodes.new("ShaderNodeMath"); m2.operation = "MAXIMUM"
    m3 = nodes.new("ShaderNodeMath"); m3.operation = "MAXIMUM"
    links.new(sep.outputs[0], m1.inputs[0]); links.new(sep.outputs[1], m1.inputs[1])
    links.new(m1.outputs[0], m2.inputs[0]); links.new(sep.outputs[2], m2.inputs[1])
    links.new(m2.outputs[0], m3.inputs[0]); links.new(rl.outputs["Alpha"], m3.inputs[1])
    clamp = nodes.new("ShaderNodeClamp")
    links.new(m3.outputs[0], clamp.inputs[0])
    setalpha = nodes.new("CompositorNodeSetAlpha")
    try:
        setalpha.inputs["Type"].default_value = "Replace Alpha"
    except Exception as exc:
        print("set alpha mode skipped:", exc)
    links.new(glare.outputs[0], setalpha.inputs["Image"])
    links.new(clamp.outputs[0], setalpha.inputs["Alpha"])
    links.new(setalpha.outputs[0], out.inputs[0])
    sc.compositing_node_group = ng


def add_outline(color="b4c0ff", thickness=1.25):
    """Freestyle rim, as two line sets:
    1. the outer silhouette against the background: always drawn, never filtered, so it's unbroken;
    2. inner contours (legs in front of the body, ears): only long lines, so small bumps on the
       mesh don't turn into stray dashes."""
    sc = bpy.context.scene
    sc.render.use_freestyle = True
    sc.render.line_thickness_mode = "ABSOLUTE"
    fs = bpy.context.view_layer.freestyle_settings
    no_lines = bpy.data.collections.new("NoLines")
    sc.collection.children.link(no_lines)
    for o in list(bpy.data.objects):
        if o.name.startswith(("Eye", "Slit", "Crown", "Dust", "Sparkle", "TipStar", "Wisp", "Food", "Toy")):
            for c in list(o.users_collection):
                c.objects.unlink(o)
            no_lines.objects.link(o)
    while fs.linesets:
        fs.linesets.remove(fs.linesets[0])

    def lineset(name, external_only, min_length):
        ls = fs.linesets.new(name)
        ls.select_by_collection = True
        ls.collection = no_lines
        ls.collection_negation = "EXCLUSIVE"
        ls.select_by_face_marks = True
        ls.face_mark_negation = "EXCLUSIVE"
        ls.face_mark_condition = "ONE"
        ls.select_by_visibility = True
        ls.select_by_edge_types = True
        for attr in ("select_silhouette", "select_border", "select_crease", "select_contour",
                     "select_external_contour", "select_suggestive_contour", "select_ridge_valley",
                     "select_material_boundary", "select_edge_mark"):
            setattr(ls, attr, False)
        if external_only:
            ls.select_external_contour = True
        else:
            ls.select_silhouette = True
            ls.select_contour = True
        style = bpy.data.linestyles.new(name + "Style")
        ls.linestyle = style
        style.color = hex_rgb(color)[:3]
        style.thickness = thickness
        style.use_chaining = True
        if min_length:
            style.use_length_min = True
            style.length_min = min_length
        return ls

    lineset("Outer", True, 0)
    lineset("Inner", False, 34.0)
