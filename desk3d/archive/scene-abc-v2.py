"""Build and render the 3D desk scene for the site's home page.

    Blender -b -P desk3d/scene.py -- --version B                 # preview -> desk3d/renders/preview-B.png
    Blender -b -P desk3d/scene.py -- --version B --mode final    # 4K -> public/desk/scene.jpg (+ renders/final-B.jpg)

Versions (all settings live in VERSIONS below, so any of them can be re-rendered later):
    A  scene changes only, no color grade
    B  A + slightly warmer + very fine grain (no desaturation, no vignette)
    C  B + a little more contrast, deeper blacks

Units are meters. World +X is image right, +Y is image up, the desk top is z = 0.
Besides the render, the script projects every clickable object's bounding box
onto the camera and writes app/desk-hotspots.json for page.tsx.
(The earlier low-sun experiment is kept in desk3d/archive/scene-sunlight-v1.py.)
"""

import argparse
import json
import math
import os
import shutil
import sys

import bmesh
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------------------------------------------------------------------------
# Versions: color grade settings (lighting, materials and layout are shared)
# ---------------------------------------------------------------------------
VERSIONS = {
    # warm: (input, output) white point in K; gamma > 1 deepens darks, whites stay put
    "A": dict(warm=None, grain=0.0, gamma=1.0, black_level=0.0),
    "B": dict(warm=(6900, 6500), grain=0.05, gamma=1.0, black_level=0.0),
    "C": dict(warm=(6900, 6500), grain=0.05, gamma=1.12, black_level=0.01),
}
AO_STRENGTH = 0.25  # contact shadows, part of the lighting in every version

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--version", choices=sorted(VERSIONS), default="B")
ap.add_argument("--mode", choices=["preview", "final"], default="preview")
ap.add_argument("--samples", type=int, default=None, help="override samples")
args = ap.parse_args(argv)
VERSION = VERSIONS[args.version]

MODES = {
    "preview": dict(res=(960, 600), samples=48, fmt="PNG",
                    out=f"desk3d/renders/preview-{args.version}.png"),
    "final": dict(res=(3840, 2400), samples=256, fmt="JPEG",
                  out="public/desk/scene.jpg", copy=f"desk3d/renders/final-{args.version}.jpg"),
}
MODE = MODES[args.mode]

# Frame: orthographic, 0.9 m wide, 16:10
FRAME_W = 0.9

FONT_PATH = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
PHOTO_PATH = os.path.join(ROOT, "public/desk/oldphoto.webp")
# oldphoto.webp is a scan with album borders; the photo itself sits in this
# pixel box (972 x 770 image). Aspect 873:580 ~ 1.5, same as the print window.
PHOTO_IMG = (972, 770)
PHOTO_BOX = (62, 80, 935, 660)  # left, top, right, bottom

# ---------------------------------------------------------------------------
# Reset
# ---------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
coll = scene.collection


def srgb(hexstr):
    """'#rrggbb' -> linear RGB tuple (Principled colors are linear)."""
    hexstr = hexstr.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(hexstr[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------
def _bsdf(m):
    if hasattr(m, "use_nodes") and not m.use_nodes:
        m.use_nodes = True
    return m.node_tree.nodes.get("Principled BSDF")


def material(name, color, rough=0.5, metal=0.0, **inputs):
    m = bpy.data.materials.new(name)
    b = _bsdf(m)
    b.inputs["Base Color"].default_value = (*srgb(color), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    for k, v in inputs.items():
        b.inputs[k].default_value = v
    return m


def screen_material():
    """Soft light blue-gray gradient, barely self-lit so it never blows out."""
    m = bpy.data.materials.new("screen")
    b = _bsdf(m)
    nt = m.node_tree
    coord = nt.nodes.new("ShaderNodeTexCoord")
    grad = nt.nodes.new("ShaderNodeTexGradient")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*srgb("#d3dce6"), 1)
    ramp.color_ramp.elements[1].color = (*srgb("#9db1c6"), 1)
    nt.links.new(coord.outputs["Generated"], grad.inputs["Vector"])
    nt.links.new(grad.outputs["Color"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = 0.6  # the screen faces away from the key light
    b.inputs["Roughness"].default_value = 0.3
    return m


def photo_material():
    m = bpy.data.materials.new("photo")
    b = _bsdf(m)
    tex = m.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(PHOTO_PATH)
    tex.extension = "CLIP"
    m.node_tree.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.35
    return m


M = {
    "desk": material("desk", "#efe9e0", rough=0.75),
    # silver-gray body: clearly darker than the desk so the outline reads
    "silver": material("silver", "#c2c4c8", rough=0.42, metal=0.25),
    "silver_dark": material("silver_dark", "#a9abb0", rough=0.42, metal=0.25),
    "keys": material("keys", "#3a3b3e", rough=0.75),
    "trackpad": material("trackpad", "#d4d5d8", rough=0.7, metal=0.05),
    "black": material("black", "#1c1c1d", rough=0.65),
    "black_gloss": material("black_gloss", "#0e0e10", rough=0.68, **{"Specular IOR Level": 0.35}),
    "white": material("white", "#f7f6f3", rough=0.55),
    "white_gloss": material("white_gloss", "#fbfbfa", rough=0.28),
    "paper": material("paper", "#fbfaf7", rough=0.8),
    "line": material("line", "#dcdad5", rough=0.8),
    "lanyard": material("lanyard", "#c9cacc", rough=0.85),
    "ink": material("ink", "#2b2b2b", rough=0.6),
    "blue": material("blue", "#bcd3e6", rough=0.6),
    "wood": material("wood", "#d8b98f", rough=0.6),
    "brush_tip": material("brush_tip", "#5a4a3d", rough=0.7),
    "ceramic": material("ceramic", "#f6f4f0", rough=0.3),
    "screen": screen_material(),
    "photo": photo_material(),
}
WATERCOLORS = ["#a9c4dd", "#e3b768", "#d99a95", "#a9bfa3", "#9fa3aa", "#c98e6c", "#c7b3cf"]

# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------
def make_obj(name, bm, mat=None, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    if mat:
        me.materials.append(mat)
    ob.parent = parent
    ob.location = loc
    ob.rotation_euler = rot
    if bevel > 0:
        # tiny edge bevels only: wide ones catch the light and glow white
        mod = ob.modifiers.new("Bevel", "BEVEL")
        mod.width = min(bevel, 0.0006)
        mod.segments = 3
        mod.limit_method = "ANGLE"
        mod.harden_normals = True
    return ob


def rbox(w, d, h, r=0.0):
    """Box w x d x h (bottom at z=0) with rounded vertical corners of radius r."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= w
        v.co.y *= d
        v.co.z = (v.co.z + 0.5) * h
    if r > 0:
        vertical = [
            e for e in bm.edges
            if abs(e.verts[0].co.x - e.verts[1].co.x) < 1e-9
            and abs(e.verts[0].co.y - e.verts[1].co.y) < 1e-9
        ]
        bmesh.ops.bevel(
            bm, geom=vertical, offset=min(r, w / 2 - 1e-4, d / 2 - 1e-4),
            segments=8, profile=0.5, affect="EDGES",
        )
    return bm


def cylinder(r, h, segments=96, r_top=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments,
                          radius1=r, radius2=r if r_top is None else r_top, depth=h)
    for v in bm.verts:
        v.co.z += h / 2
    return bm


def plane_uv(w, d, uv_box):
    """Flat rectangle with explicit UVs (u0, v0, u1, v1)."""
    bm = bmesh.new()
    vs = [bm.verts.new((x * w / 2, y * d / 2, 0)) for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    f = bm.faces.new(vs)
    uv = bm.loops.layers.uv.new()
    u0, v0, u1, v1 = uv_box
    for loop, (u, v) in zip(f.loops, ((u0, v0), (u1, v0), (u1, v1), (u0, v1))):
        loop[uv].uv = (u, v)
    return bm


def ribbon(points, width, z=0.0, samples=24):
    """Flat strip along a Catmull-Rom curve through 2D points."""
    pts = [Vector((x, y)) for x, y in points]
    pts = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    path = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for s in range(samples):
            t = s / samples
            path.append(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                               + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    path.append(pts[-2])
    bm = bmesh.new()
    left, right = [], []
    for i, p in enumerate(path):
        a = path[max(i - 1, 0)]
        b = path[min(i + 1, len(path) - 1)]
        t = (b - a).normalized()
        n = Vector((-t.y, t.x)) * width / 2
        left.append(bm.verts.new((p.x + n.x, p.y + n.y, z)))
        right.append(bm.verts.new((p.x - n.x, p.y - n.y, z)))
    for i in range(len(path) - 1):
        bm.faces.new((left[i], right[i], right[i + 1], left[i + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def solidify(ob, thickness):
    mod = ob.modifiers.new("Solidify", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = 1.0
    return ob


def empty(name, loc, rot_z_deg, scale=1.0):
    ob = bpy.data.objects.new(name, None)
    coll.objects.link(ob)
    ob.location = (*loc, 0)
    ob.rotation_euler = (0, 0, math.radians(rot_z_deg))
    ob.scale = (scale, scale, scale)
    return ob


FONT = bpy.data.fonts.load(FONT_PATH) if os.path.exists(FONT_PATH) else None


def text(name, body, size, parent, loc, mat, spacing=1.0):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    cu.size = size
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.extrude = 0.00008
    cu.space_character = spacing
    if FONT:
        cu.font = FONT
    ob = bpy.data.objects.new(name, cu)
    coll.objects.link(ob)
    cu.materials.append(mat)
    ob.parent = parent
    ob.location = loc
    return ob


# ---------------------------------------------------------------------------
# Desk
# ---------------------------------------------------------------------------
make_obj("desk", rbox(4, 4, 0.04), M["desk"], loc=(0, 0, -0.04), smooth=False)

CLICKABLE = {}  # id -> root object

# Laptop: base 30.4 x 21.2 cm, lid opened to ~125 deg -------------------------
laptop = empty("laptop", (-0.025, 0.072), -6)
CLICKABLE["laptop"] = laptop
BW, BD, BH = 0.304, 0.212, 0.011
make_obj("laptop_base", rbox(BW, BD, BH, 0.012), M["silver"], laptop, bevel=0.0006)
make_obj("keyboard", rbox(0.266, 0.104, 0.0006, 0.006), M["keys"], laptop, loc=(0, 0.036, BH))
make_obj("trackpad", rbox(0.118, 0.072, 0.0004, 0.006), M["trackpad"], laptop, loc=(0, -0.058, BH))
hinge = empty("laptop_hinge", (0, 0), 0)
hinge.parent = laptop
hinge.location = (0, BD / 2 - 0.002, BH)
hinge.rotation_euler = (math.radians(58), 0, 0)  # lift the lid 58 deg up from flat-open
LW, LD, LH = 0.304, 0.206, 0.006
make_obj("lid", rbox(LW, LD, LH, 0.012), M["silver"], hinge, loc=(0, LD / 2, -LH), bevel=0.0006)
make_obj("bezel", rbox(0.296, 0.198, 0.0006, 0.009), M["black_gloss"], hinge, loc=(0, LD / 2, 0))
make_obj("screen", rbox(0.278, 0.176, 0.0004, 0.002), M["screen"], hinge, loc=(0, LD / 2 + 0.004, 0.0006))

# Phone ---------------------------------------------------------------------
phone = empty("phone", (0.235, 0.025), 8)
CLICKABLE["phone"] = phone
make_obj("phone_body", rbox(0.072, 0.150, 0.008, 0.011), M["silver"], phone, bevel=0.0006)
make_obj("phone_screen", rbox(0.066, 0.143, 0.0004, 0.009), M["black_gloss"], phone, loc=(0, 0, 0.008))

# Notebook ------------------------------------------------------------------
notebook = empty("notebook", (-0.318, -0.152), 5)
CLICKABLE["notebook"] = notebook
make_obj("notebook_pages", rbox(0.142, 0.204, 0.016, 0.003), M["paper"], notebook, loc=(0.002, 0, 0))
make_obj("notebook_cover_bottom", rbox(0.148, 0.210, 0.002, 0.004), M["black"], notebook, bevel=0.0004)
make_obj("notebook_cover_top", rbox(0.148, 0.210, 0.002, 0.004), M["black"], notebook, loc=(0, 0, 0.016), bevel=0.0004)
make_obj("notebook_label", rbox(0.058, 0.026, 0.0004, 0.002), M["white"], notebook, loc=(0, 0.055, 0.018))
text("notebook_text", "NOW", 0.0125, notebook, (0, 0.055, 0.0186), M["ink"], spacing=1.25)

# Badge (1.3x) + lanyard ----------------------------------------------------------
badge = empty("badge", (-0.305, 0.045), -7, scale=1.3)
CLICKABLE["badge"] = badge
make_obj("badge_card", rbox(0.056, 0.086, 0.0016, 0.004), M["white"], badge, bevel=0.0004)
make_obj("badge_band", rbox(0.056, 0.016, 0.0003, 0.0), M["blue"], badge, loc=(0, 0.033, 0.0016))
make_obj("badge_slot", rbox(0.014, 0.003, 0.0003, 0.0015), M["silver_dark"], badge, loc=(0, 0.037, 0.0019))
make_obj("badge_clip", rbox(0.010, 0.016, 0.003, 0.003), M["silver"], badge, loc=(0, 0.049, 0.0), bevel=0.0006)
text("badge_text", "JINGWEN WANG", 0.0054, badge, (0, -0.012, 0.0017), M["ink"], spacing=1.1)
bpy.context.view_layer.update()
clip = (badge.matrix_world @ Vector((0, 0.056, 0))).xy
for i, pts in enumerate([
    [(-0.50, 0.170), (-0.43, 0.172), (-0.37, clip.y + 0.022), clip[:]],
    [(-0.50, 0.090), (-0.43, 0.104), (-0.37, clip.y - 0.010), clip[:]],
]):
    solidify(make_obj(f"lanyard_{i}", ribbon(pts, 0.010, z=0.0002 + i * 0.0012), M["lanyard"], smooth=False), 0.0008)

# Print (4x6-ish, white border) -------------------------------------------------
pr = empty("print", (-0.055, -0.118), -4)
CLICKABLE["print"] = pr
make_obj("print_paper", rbox(0.160, 0.122, 0.0008, 0.0015), M["paper"], pr)
pl, pt, prr, pb = PHOTO_BOX
iw, ih = PHOTO_IMG
make_obj("print_photo", plane_uv(0.144, 0.096, (pl / iw, 1 - pb / ih, prr / iw, 1 - pt / ih)),
         M["photo"], pr, loc=(0, 0.005, 0.00085), smooth=False)

# Palette: round dish with recessed wells + brush -------------------------------
palette = empty("palette", (0.115, -0.108), 3)
CLICKABLE["palette"] = palette
DISH_H = 0.008
dish = make_obj("palette_dish", cylinder(0.05, DISH_H), M["ceramic"], palette, bevel=0.0006)
wells = [(0.0, 0.0)] + [
    (0.029 * math.cos(math.radians(90 + k * 60)), 0.029 * math.sin(math.radians(90 + k * 60)))
    for k in range(len(WATERCOLORS) - 1)
]
cut = bmesh.new()
for x, y in wells:
    tmp = cylinder(0.0108, 0.01, segments=48)
    for v in tmp.verts:
        v.co.x += x
        v.co.y += y
        v.co.z += DISH_H - 0.0028
    tmp_me = bpy.data.meshes.new("tmp")
    tmp.to_mesh(tmp_me)
    tmp.free()
    cut.from_mesh(tmp_me)
    bpy.data.meshes.remove(tmp_me)
cutter = make_obj("palette_cutter", cut, None, palette, smooth=False)
cutter.hide_render = True
cutter.display_type = "WIRE"
boolean = dish.modifiers.new("Wells", "BOOLEAN")
boolean.operation = "DIFFERENCE"
boolean.object = cutter
for i, (c, (x, y)) in enumerate(zip(WATERCOLORS, wells)):
    make_obj(f"paint_{i}", cylinder(0.0104, 0.0005, segments=48), material(f"paint_{i}", c, rough=0.45),
             palette, loc=(x, y, DISH_H - 0.0028))

along_x = (0, math.radians(90), 0)  # cylinders then span [loc.x, loc.x + h] along +X
brush = empty("brush", (0.065, -0.183), 10)
make_obj("brush_handle", cylinder(0.0028, 0.12, 32), M["wood"], brush, loc=(0, 0, 0.003), rot=along_x)
make_obj("brush_ferrule", cylinder(0.0031, 0.018, 32), M["silver"], brush, loc=(-0.018, 0, 0.003), rot=along_x)
make_obj("brush_tip", cylinder(0.0026, 0.014, 32), M["brush_tip"], brush, loc=(-0.032, 0, 0.003), rot=along_x)

# Paper (A4, spilling off the bottom-right corner) ----------------------------
paper = empty("paper", (0.37, -0.185), 9)
CLICKABLE["paper"] = paper
make_obj("paper_sheet", rbox(0.210, 0.297, 0.0004), M["paper"], paper, smooth=False)
for i in range(9):
    make_obj(f"paper_line_{i}", rbox(0.150 if i % 3 else 0.090, 0.0016, 0.0001), M["line"], paper,
             loc=(-0.02 if i % 3 == 0 else 0, 0.11 - i * 0.02, 0.0004), smooth=False)

# Mechanical pencil (decor), ~35 deg next to the paper ----------------------------
pencil = empty("pencil", (0.218, -0.165), 35)
R = 0.0034
make_obj("pencil_body", cylinder(R, 0.130, 32), M["black"], pencil, loc=(-0.065, 0, R), rot=along_x)
make_obj("pencil_grip", cylinder(R * 1.08, 0.030, 32), M["black"], pencil, loc=(0.030, 0, R), rot=along_x)
make_obj("pencil_tip", cylinder(R, 0.012, 32, r_top=0.0009), M["silver"], pencil, loc=(0.065, 0, R), rot=along_x)
make_obj("pencil_lead", cylinder(0.00035, 0.003, 12), M["keys"], pencil, loc=(0.077, 0, R), rot=along_x)
make_obj("pencil_cap", cylinder(R * 0.9, 0.009, 32), M["silver"], pencil, loc=(-0.074, 0, R), rot=along_x)
make_obj("pencil_clip", rbox(0.032, 0.0018, 0.0012, 0.0008), M["silver"], pencil, loc=(-0.048, 0, 2 * R))

# Earbuds case (decor) ----------------------------------------------------------
buds = empty("earbuds", (-0.095, -0.245), -5)
make_obj("earbuds_case", rbox(0.050, 0.044, 0.022, 0.016), M["white_gloss"], buds, bevel=0.0006)

# ---------------------------------------------------------------------------
# Camera, light, world
# ---------------------------------------------------------------------------
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = FRAME_W
cam = bpy.data.objects.new("cam", cam_data)
coll.objects.link(cam)
cam.location = (0, 0, 2.0)
scene.camera = cam

# Large soft key from the top-left; a bit higher than before so the laptop lid
# doesn't throw a big shadow across the desk
key_data = bpy.data.lights.new("key", "AREA")
key_data.shape = "DISK"
key_data.size = 1.6
key_data.energy = 260 * (4.6 ** 2 + 3.34 ** 2) / (3.6 ** 2 + 3.34 ** 2)  # same light on the desk
key = bpy.data.objects.new("key", key_data)
coll.objects.link(key)
key.location = (-2.5, 2.2, 4.6)
key.rotation_euler = (Vector((0, 0, 0)) - key.location).to_track_quat("-Z", "Y").to_euler()

world = bpy.data.worlds.new("world")
scene.world = world
if hasattr(world, "use_nodes") and not world.use_nodes:
    world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs["Color"].default_value = (1, 1, 1, 1)
bg.inputs["Strength"].default_value = 0.07
world.light_settings.distance = 0.03  # AO distance: contact shadows

# ---------------------------------------------------------------------------
# Render settings
# ---------------------------------------------------------------------------
scene.render.engine = "CYCLES"
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = "GPU"
except Exception as e:  # noqa: BLE001
    print("[desk3d] Metal unavailable, using CPU:", e)

scene.cycles.samples = args.samples or MODE["samples"]
scene.cycles.use_adaptive_sampling = True
scene.cycles.use_denoising = True
try:
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
except Exception:  # noqa: BLE001
    pass
scene.cycles.max_bounces = 8

scene.render.resolution_x, scene.render.resolution_y = MODE["res"]
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.view_settings.exposure = 0.0
bpy.context.view_layer.use_pass_ambient_occlusion = True

out_path = os.path.join(ROOT, MODE["out"])
os.makedirs(os.path.dirname(out_path), exist_ok=True)
scene.render.filepath = out_path
scene.render.image_settings.file_format = MODE["fmt"]
scene.render.image_settings.color_mode = "RGB"
if MODE["fmt"] == "JPEG":
    scene.render.image_settings.quality = 90


# ---------------------------------------------------------------------------
# Compositor: AO (all versions) + the version's color grade
# ---------------------------------------------------------------------------
def build_compositor(v):
    W = MODE["res"][0]
    ng = bpy.data.node_groups.new("grade", "CompositorNodeTree")
    ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    N, L = ng.nodes, ng.links

    def mix(blend, a, b, fac):
        n = N.new("ShaderNodeMix")
        n.data_type = "RGBA"
        n.blend_type = blend
        n.clamp_result = False
        n.inputs["Factor"].default_value = fac
        L.new(a, n.inputs[6])  # A (color)
        L.new(b, n.inputs[7])  # B (color)
        return n.outputs[2]

    rl = N.new("CompositorNodeRLayers")
    img = rl.outputs["Image"]

    # contact shadows / AO: objects sit on the desk
    img = mix("MULTIPLY", img, rl.outputs["Ambient Occlusion"], AO_STRENGTH)

    if v["warm"]:
        # input white point higher than output -> image shifts slightly warmer
        wb = N.new("CompositorNodeColorBalance")
        wb.inputs["Type"].default_value = "White Point"
        wb.inputs["Input Temperature"].default_value = v["warm"][0]
        wb.inputs["Output Temperature"].default_value = v["warm"][1]
        L.new(img, wb.inputs["Image"])
        img = wb.outputs["Image"]

    if v["black_level"]:
        curve = N.new("CompositorNodeCurveRGB")
        curve.inputs["Black Level"].default_value = (v["black_level"],) * 3 + (1,)
        L.new(img, curve.inputs["Image"])
        img = curve.outputs["Image"]
    if v["gamma"] != 1.0:
        gm = N.new("ShaderNodeGamma")
        gm.inputs["Gamma"].default_value = v["gamma"]
        L.new(img, gm.inputs["Color"])
        img = gm.outputs["Color"]

    if v["grain"]:
        coords = N.new("CompositorNodeImageCoordinates")
        L.new(rl.outputs["Image"], coords.inputs["Image"])  # gives the node the frame size
        noise = N.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = W * 0.6
        noise.inputs["Detail"].default_value = 0
        L.new(coords.outputs["Normalized"], noise.inputs["Vector"])
        img = mix("OVERLAY", img, noise.outputs["Color"], v["grain"])

    out = N.new("NodeGroupOutput")
    L.new(img, out.inputs[0])
    return ng


scene.compositing_node_group = build_compositor(VERSION)
scene.render.use_compositing = True
scene.render.compositor_device = "CPU"  # the Metal compositor has given wrong results here

# ---------------------------------------------------------------------------
# Hotspots: project each clickable object's bounding box onto the camera
# ---------------------------------------------------------------------------
bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()
W, H = MODE["res"]


def hotspot(root):
    inv = root.matrix_world.inverted()
    xs, ys = [], []
    for ob in root.children_recursive:
        if ob.type not in {"MESH", "FONT"} or ob.hide_render:
            continue
        ev = ob.evaluated_get(depsgraph)
        me = ev.to_mesh()
        mat = inv @ ob.matrix_world
        for v in me.vertices:
            p = mat @ v.co
            xs.append(p.x)
            ys.append(p.y)
        ev.to_mesh_clear()
    local = [(min(xs), min(ys)), (max(xs), min(ys)), (max(xs), max(ys)), (min(xs), max(ys))]
    px = []
    for x, y in local:
        c = world_to_camera_view(scene, cam, root.matrix_world @ Vector((x, y, 0)))
        px.append(Vector((c.x * W, (1 - c.y) * H)))
    w_px = (px[1] - px[0]).length
    h_px = (px[2] - px[1]).length
    cx = sum(p.x for p in px) / 4
    cy = sum(p.y for p in px) / 4
    rot = -math.degrees(root.matrix_world.to_euler().z)  # CSS rotate is clockwise
    return {
        "left": round((cx - w_px / 2) / W * 100, 2),
        "top": round((cy - h_px / 2) / H * 100, 2),
        "width": round(w_px / W * 100, 2),
        "height": round(h_px / H * 100, 2),
        "rotate": round(rot, 1),
        "corners": [(p.x / W, p.y / H) for p in px],
    }


spots = {k: hotspot(v) for k, v in CLICKABLE.items()}


# The bottom dock must not cover any hotspot. Check typical viewports: the
# scene is a 16:10 box covering the window (cover-fit), dock ~600x50 px at bottom.
def dock_rect(vw, vh, dock_w=600, dock_h=50, bottom=20, pad=12):
    sw, sh = max(vw, vh * 1.6), max(vh, vw / 1.6)
    ox, oy = (sw - vw) / 2, (sh - vh) / 2
    x0 = (vw - dock_w) / 2 - pad + ox
    x1 = (vw + dock_w) / 2 + pad + ox
    y0 = vh - bottom - dock_h - pad + oy
    y1 = vh - bottom + oy
    return (x0 / sw, y0 / sh, x1 / sw, y1 / sh)


def overlaps(poly, rect):
    """Separating-axis test: convex quad vs axis-aligned rect (fractions)."""
    x0, y0, x1, y1 = rect
    rpoly = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    for shape in (poly, rpoly):
        for i in range(4):
            ax, ay = shape[i]
            bx, by = shape[(i + 1) % 4]
            nx, ny = by - ay, ax - bx
            pa = [nx * px + ny * py for px, py in poly]
            pb = [nx * px + ny * py for px, py in rpoly]
            if max(pa) < min(pb) or max(pb) < min(pa):
                return False
    return True


problems = []
for vw, vh in [(1440, 900), (1280, 800), (1920, 1080), (1536, 864), (1100, 1000)]:
    rect = dock_rect(vw, vh)
    for k, s in spots.items():
        if overlaps(s["corners"], rect):
            problems.append(f"{k} under dock at {vw}x{vh}")
print("[desk3d] dock check:", problems or "ok")

hot_path = os.path.join(ROOT, "app/desk-hotspots.json")
with open(hot_path, "w") as f:
    json.dump(
        {
            "image": {"w": W, "h": H},
            "hotspots": [
                {"id": k, **{kk: vv for kk, vv in s.items() if kk != "corners"},
                 **({"round": True} if k == "palette" else {})}
                for k, s in spots.items()
            ],
        },
        f,
        indent=2,
    )
    f.write("\n")
print("[desk3d] wrote", hot_path)

bpy.ops.render.render(write_still=True)
if MODE.get("copy"):
    copy_path = os.path.join(ROOT, MODE["copy"])
    shutil.copyfile(out_path, copy_path)
    print("[desk3d] saved a copy as", copy_path)
print("[desk3d] rendered", out_path, "version", args.version)
