"""Build and render the 3D desk scene for the site's home page.

This is the original cream-desk version (first preview round), with only:
  - the iced latte and its coaster removed (their spot stays empty)
  - the laptop moved right to leave the top-left clear for the page title
  - a title-area check next to the dock check

    Blender -b -P desk3d/scene.py -- --version A                 # preview -> desk3d/renders/preview-orig-A.png
    Blender -b -P desk3d/scene.py -- --version B --mode final    # 4K -> public/desk/scene.jpg (+ renders/final-orig-B.jpg)

Versions (settings live in VERSIONS, so either can be re-rendered later):
    A  exactly the original look
    B  A, minus the white rim on object edges (narrower edge bevels), nothing else

Earlier experiments are kept in desk3d/archive/.
Units are meters. World +X is image right, +Y is image up, the desk top is z = 0.
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

# max edge-bevel width in meters (None = the original widths, which catch the
# key light and read as a white rim around objects). Bevels wider than
# SHAPE_BEVEL shape the object itself (the earbuds case) and are never capped.
VERSIONS = {
    "A": dict(bevel_cap=None),
    "B": dict(bevel_cap=0.0003),
}

# Move the laptop right (meters) so the page title fits in the top-left corner
SHAPE_BEVEL = 0.005

LAPTOP_SHIFT_X = 0.035  # 0.02-0.04 passes both the title check and the phone/badge overlap check

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--version", choices=sorted(VERSIONS), default="A")
ap.add_argument("--mode", choices=["preview", "final"], default="preview")
ap.add_argument("--samples", type=int, default=None, help="override samples")
ap.add_argument("--laptop-shift", type=float, default=None, help="tuning: override LAPTOP_SHIFT_X")
args = ap.parse_args(argv)
VERSION = VERSIONS[args.version]
if args.laptop_shift is not None:
    LAPTOP_SHIFT_X = args.laptop_shift

MODES = {
    "preview": dict(res=(960, 600), samples=32, fmt="PNG",
                    out=f"desk3d/renders/preview-orig-{args.version}.png"),
    "final": dict(res=(3840, 2400), samples=256, fmt="JPEG",
                  out="public/desk/scene.jpg", copy=f"desk3d/renders/final-orig-{args.version}.jpg"),
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
# Materials (original)
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
    """Soft light blue-gray gradient, slightly self-lit."""
    m = bpy.data.materials.new("screen")
    b = _bsdf(m)
    nt = m.node_tree
    coord = nt.nodes.new("ShaderNodeTexCoord")
    grad = nt.nodes.new("ShaderNodeTexGradient")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*srgb("#dfe6ee"), 1)
    ramp.color_ramp.elements[1].color = (*srgb("#a9bcd0"), 1)
    nt.links.new(coord.outputs["Generated"], grad.inputs["Vector"])
    nt.links.new(grad.outputs["Color"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = 0.25
    b.inputs["Roughness"].default_value = 0.25
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
    "silver": material("silver", "#d6d7da", rough=0.42, metal=0.25),
    "silver_dark": material("silver_dark", "#b4b6ba", rough=0.42, metal=0.25),
    "keys": material("keys", "#3a3b3e", rough=0.6),
    "trackpad": material("trackpad", "#e0e1e3", rough=0.5, metal=0.1),
    "black": material("black", "#1c1c1d", rough=0.65),
    "black_gloss": material("black_gloss", "#0e0e10", rough=0.6),
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
        cap = VERSION["bevel_cap"]
        mod = ob.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel if cap is None or bevel >= SHAPE_BEVEL else min(bevel, cap)
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


def cylinder(r, h, segments=96):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments,
                          radius1=r, radius2=r, depth=h)
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


def empty(name, loc, rot_z_deg):
    ob = bpy.data.objects.new(name, None)
    coll.objects.link(ob)
    ob.location = (*loc, 0)
    ob.rotation_euler = (0, 0, math.radians(rot_z_deg))
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
# Desk and objects (original positions and angles)
# ---------------------------------------------------------------------------
make_obj("desk", rbox(4, 4, 0.04), M["desk"], loc=(0, 0, -0.04), smooth=False)

CLICKABLE = {}  # id -> root object
DECOR = {}      # id -> root object (not clickable, still kept out of the title area)

# Laptop: base 30.4 x 21.2 cm, lid opened to ~125 deg -------------------------
laptop = empty("laptop", (-0.025 + LAPTOP_SHIFT_X, 0.10), -18)
CLICKABLE["laptop"] = laptop
BW, BD, BH = 0.304, 0.212, 0.011
make_obj("laptop_base", rbox(BW, BD, BH, 0.012), M["silver"], laptop, bevel=0.002)
make_obj("keyboard", rbox(0.266, 0.104, 0.0006, 0.006), M["keys"], laptop, loc=(0, 0.036, BH), bevel=0.0002)
make_obj("trackpad", rbox(0.118, 0.072, 0.0004, 0.006), M["trackpad"], laptop, loc=(0, -0.058, BH), bevel=0.0002)
hinge = empty("laptop_hinge", (0, 0), 0)
hinge.parent = laptop
hinge.location = (0, BD / 2 - 0.002, BH)
hinge.rotation_euler = (math.radians(58), 0, 0)  # lift the lid 58 deg up from flat-open
LW, LD, LH = 0.304, 0.206, 0.006
make_obj("lid", rbox(LW, LD, LH, 0.012), M["silver"], hinge, loc=(0, LD / 2, -LH), bevel=0.002)
make_obj("bezel", rbox(0.296, 0.198, 0.0006, 0.009), M["black_gloss"], hinge, loc=(0, LD / 2, 0), bevel=0.0002)
make_obj("screen", rbox(0.278, 0.176, 0.0004, 0.002), M["screen"], hinge, loc=(0, LD / 2 + 0.004, 0.0006))

# Phone ---------------------------------------------------------------------
phone = empty("phone", (0.235, 0.025), 18)
CLICKABLE["phone"] = phone
make_obj("phone_body", rbox(0.072, 0.150, 0.008, 0.011), M["silver"], phone, bevel=0.0015)
make_obj("phone_screen", rbox(0.066, 0.143, 0.0004, 0.009), M["black_gloss"], phone, loc=(0, 0, 0.008))

# Notebook ------------------------------------------------------------------
notebook = empty("notebook", (-0.318, -0.152), 13)
CLICKABLE["notebook"] = notebook
make_obj("notebook_pages", rbox(0.142, 0.204, 0.016, 0.003), M["paper"], notebook, loc=(0.002, 0, 0), bevel=0.0008)
make_obj("notebook_cover_bottom", rbox(0.148, 0.210, 0.002, 0.004), M["black"], notebook, bevel=0.0006)
make_obj("notebook_cover_top", rbox(0.148, 0.210, 0.002, 0.004), M["black"], notebook, loc=(0, 0, 0.016), bevel=0.0006)
make_obj("notebook_label", rbox(0.058, 0.026, 0.0004, 0.002), M["white"], notebook, loc=(0, 0.055, 0.018))
text("notebook_text", "NOW", 0.0125, notebook, (0, 0.055, 0.0186), M["ink"], spacing=1.25)

# Badge + lanyard -------------------------------------------------------------
badge = empty("badge", (-0.31, 0.015), -8)
CLICKABLE["badge"] = badge
make_obj("badge_card", rbox(0.056, 0.086, 0.0016, 0.004), M["white"], badge, bevel=0.0004)
make_obj("badge_band", rbox(0.056, 0.016, 0.0003, 0.0), M["blue"], badge, loc=(0, 0.033, 0.0016))
make_obj("badge_slot", rbox(0.014, 0.003, 0.0003, 0.0015), M["silver_dark"], badge, loc=(0, 0.037, 0.0019))
make_obj("badge_clip", rbox(0.010, 0.016, 0.003, 0.003), M["silver"], badge, loc=(0, 0.049, 0.0), bevel=0.0008)
text("badge_text", "JINGWEN WANG", 0.0054, badge, (0, -0.012, 0.0017), M["ink"], spacing=1.1)
bpy.context.view_layer.update()
clip_world = badge.matrix_world @ Vector((0, 0.056, 0))
LANYARDS = []
for i, pts in enumerate([
    [(-0.50, 0.125), (-0.42, 0.128), (-0.36, 0.105), clip_world.xy[:]],
    [(-0.50, 0.050), (-0.42, 0.066), (-0.36, 0.085), clip_world.xy[:]],
]):
    LANYARDS.append(solidify(make_obj(f"lanyard_{i}", ribbon(pts, 0.010, z=0.0002 + i * 0.0012),
                                      M["lanyard"], smooth=False), 0.0008))

# Print (4x6-ish, white border, slightly tilted) ------------------------------
pr = empty("print", (-0.055, -0.105), -9)
CLICKABLE["print"] = pr
make_obj("print_paper", rbox(0.160, 0.122, 0.0008, 0.0015), M["paper"], pr)
pl, pt, prr, pb = PHOTO_BOX
iw, ih = PHOTO_IMG
make_obj("print_photo", plane_uv(0.144, 0.096, (pl / iw, 1 - pb / ih, prr / iw, 1 - pt / ih)),
         M["photo"], pr, loc=(0, 0.005, 0.00085), smooth=False)

# Palette + brush -------------------------------------------------------------
palette = empty("palette", (0.115, -0.095), 0)
CLICKABLE["palette"] = palette
make_obj("palette_dish", cylinder(0.05, 0.008), M["ceramic"], palette, bevel=0.0015)
for i, c in enumerate(WATERCOLORS):
    if i == 0:
        x, y = 0.0, 0.0
    else:
        a = math.radians(90 + (i - 1) * 60)
        x, y = 0.029 * math.cos(a), 0.029 * math.sin(a)
    make_obj(f"paint_{i}", cylinder(0.0105, 0.0006), material(f"paint_{i}", c, rough=0.5), palette, loc=(x, y, 0.008))
brush = empty("brush", (0.168, -0.20), 58)
DECOR["brush"] = brush
along_x = (0, math.radians(90), 0)  # cylinders then span [loc.x, loc.x + h] along +X
make_obj("brush_handle", cylinder(0.0028, 0.12, 32), M["wood"], brush, loc=(0, 0, 0.003), rot=along_x)
make_obj("brush_ferrule", cylinder(0.0031, 0.018, 32), M["silver"], brush, loc=(-0.018, 0, 0.003), rot=along_x)
make_obj("brush_tip", cylinder(0.0026, 0.014, 32), M["brush_tip"], brush, loc=(-0.032, 0, 0.003), rot=along_x)

# Paper (A4, spilling off the bottom-right corner) ----------------------------
paper = empty("paper", (0.37, -0.185), 16)
CLICKABLE["paper"] = paper
make_obj("paper_sheet", rbox(0.210, 0.297, 0.0004), M["paper"], paper, smooth=False)
for i in range(9):
    make_obj(f"paper_line_{i}", rbox(0.150 if i % 3 else 0.090, 0.0016, 0.0001), M["line"], paper,
             loc=(-0.02 if i % 3 == 0 else 0, 0.11 - i * 0.02, 0.0004), smooth=False)

# (the iced latte used to sit at (0.262, -0.152); that spot is left empty)

# Earbuds case (decor) ----------------------------------------------------------
buds = empty("earbuds", (-0.095, -0.245), -25)
DECOR["earbuds"] = buds
make_obj("earbuds_case", rbox(0.050, 0.044, 0.022, 0.016), M["white_gloss"], buds, bevel=0.007)

# ---------------------------------------------------------------------------
# Camera, light, world (original)
# ---------------------------------------------------------------------------
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = FRAME_W
cam = bpy.data.objects.new("cam", cam_data)
coll.objects.link(cam)
cam.location = (0, 0, 2.0)
scene.camera = cam

key_data = bpy.data.lights.new("key", "AREA")
key_data.shape = "DISK"
key_data.size = 1.6
key_data.energy = 260
key = bpy.data.objects.new("key", key_data)
coll.objects.link(key)
key.location = (-2.5, 2.2, 3.6)
key.rotation_euler = (Vector((0, 0, 0)) - key.location).to_track_quat("-Z", "Y").to_euler()

world = bpy.data.worlds.new("world")
scene.world = world
if hasattr(world, "use_nodes") and not world.use_nodes:
    world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs["Color"].default_value = (1, 1, 1, 1)
bg.inputs["Strength"].default_value = 0.07

# ---------------------------------------------------------------------------
# Render settings (original)
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
scene.render.use_compositing = False

out_path = os.path.join(ROOT, MODE["out"])
os.makedirs(os.path.dirname(out_path), exist_ok=True)
scene.render.filepath = out_path
scene.render.image_settings.file_format = MODE["fmt"]
scene.render.image_settings.color_mode = "RGB"
if MODE["fmt"] == "JPEG":
    scene.render.image_settings.quality = 90

# ---------------------------------------------------------------------------
# Footprints: project bounding boxes onto the camera
# ---------------------------------------------------------------------------
bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()
W, H = MODE["res"]


def footprint(objs, frame):
    """Bounding box of objs' vertices in `frame`'s XY axes, projected to image fractions."""
    inv = frame.inverted()
    xs, ys = [], []
    for ob in objs:
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
    out = []
    for x, y in local:
        c = world_to_camera_view(scene, cam, frame @ Vector((x, y, 0)))
        out.append(Vector((c.x, 1 - c.y)))  # fractions from the top-left
    return out


def hotspot(root):
    q = footprint(root.children_recursive, root.matrix_world)
    px = [Vector((p.x * W, p.y * H)) for p in q]
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
        "corners": [tuple(p) for p in q],
    }


spots = {k: hotspot(v) for k, v in CLICKABLE.items()}
# every object on the desk, for the title-area check
shapes = {k: s["corners"] for k, s in spots.items()}
for k, root in DECOR.items():
    shapes[k] = [tuple(p) for p in footprint(root.children_recursive, root.matrix_world)]
for ob in LANYARDS:
    shapes[ob.name] = [tuple(p) for p in footprint([ob], ob.matrix_world)]


def overlaps(a, b):
    """Separating-axis test for two convex quads (image fractions)."""
    for shape in (a, b):
        for i in range(4):
            ax, ay = shape[i]
            bx, by = shape[(i + 1) % 4]
            nx, ny = by - ay, ax - bx
            pa = [nx * px + ny * py for px, py in a]
            pb = [nx * px + ny * py for px, py in b]
            if max(pa) < min(pb) or max(pb) < min(pa):
                return False
    return True


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


# Page layout (see app/globals.css): the scene is a 16:10 box that covers the
# window; the dock sits bottom-center, the title block top-left.
VIEWPORTS = [(1440, 900), (1280, 800), (1920, 1080), (1536, 864), (1366, 768)]


def to_scene(vw, vh, x0, y0, x1, y1):
    """Viewport px rect -> scene image fractions."""
    sw, sh = max(vw, vh * 1.6), max(vh, vw / 1.6)
    ox, oy = (sw - vw) / 2, (sh - vh) / 2
    return rect((x0 + ox) / sw, (y0 + oy) / sh, (x1 + ox) / sw, (y1 + oy) / sh)


def dock_area(vw, vh, dock_w=600, dock_h=50, bottom=20, pad=12):
    return to_scene(vw, vh, (vw - dock_w) / 2 - pad, vh - bottom - dock_h - pad,
                    (vw + dock_w) / 2 + pad, vh - bottom)


def title_area(vw, vh, pad=16):
    # name at top 32 px / left 36 px; tagline; hint line ends ~118 px down;
    # the hint ("click anything on the desk · how this desk was made →") is the widest, ~380 px
    return to_scene(vw, vh, 36 - pad, 32 - pad, 36 + 380 + pad, 118 + pad)


dock_problems, title_problems = [], []
for vw, vh in VIEWPORTS:
    for k, s in spots.items():
        if overlaps(s["corners"], dock_area(vw, vh)):
            dock_problems.append(f"{k} under dock at {vw}x{vh}")
    for k, q in shapes.items():
        if overlaps(q, title_area(vw, vh)):
            title_problems.append(f"{k} in title area at {vw}x{vh}")
print("[desk3d] dock check:", dock_problems or "ok")
print("[desk3d] title check:", title_problems or "ok")
clash = [k for k in ("phone", "badge") if overlaps(spots["laptop"]["corners"], spots[k]["corners"])]
print("[desk3d] laptop overlap check:", [f"laptop overlaps {k}" for k in clash] or "ok")

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

if os.environ.get("DESK3D_CHECK_ONLY"):
    sys.exit(0)
bpy.ops.render.render(write_still=True)
if MODE.get("copy"):
    copy_path = os.path.join(ROOT, MODE["copy"])
    shutil.copyfile(out_path, copy_path)
    print("[desk3d] saved a copy as", copy_path)
print("[desk3d] rendered", out_path, "version", args.version)
