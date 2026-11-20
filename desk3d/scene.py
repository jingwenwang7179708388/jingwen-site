"""Build and render the 3D desk scene for the site's home page.

Cream desk, soft key light from the top-left (the look chosen as version B),
rendered wide (2.1:1) with every object inside a safe area, so nothing is
cut off, hidden by the dock or under the title on any window from 16:10 to
21:9 and from 1280x800 to 2560x1440.

    Blender -b -P desk3d/scene.py                          # preview  -> desk3d/renders/preview-*.png
    Blender -b -P desk3d/scene.py -- --verify              # preview + check layers rebuild the full render
    Blender -b -P desk3d/scene.py -- --mode final          # 4200x2000 -> public/desk/scene.jpg + public/desk/layers/*.png
    DESK3D_CHECK_ONLY=1 Blender -b -P desk3d/scene.py      # layout checks only, no render

Final output
  public/desk/scene.jpg        the desk without the clickable objects / earbuds,
                               but with the shadows they cast
  public/desk/layers/<id>.png  each clickable object + the earbuds, transparent,
                               cropped to its bounding box
  app/desk-hotspots.json       image size, click areas, layer boxes (percent of the image)

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

# ---------------------------------------------------------------------------
# Parameters
# ---------------------------------------------------------------------------
# Texture on the print. crop = (left, top, right, bottom) in pixels, or None to
# center-crop the whole image to the print window (3:2).
#   later: PHOTO = dict(path="public/desk/headshot.jpg", crop=None)
PHOTO = dict(path="public/desk/oldphoto.webp", crop=(62, 80, 935, 660))

NOTEBOOK_LABEL = "SKILLS"

ASPECT = 2.1      # render width / height
FRAME_W = 1.6     # meters of desk across the full render width
BEVEL_CAP = 0.0003   # narrow edge bevels: no white rim on object edges (version B)
SHAPE_BEVEL = 0.005  # bevels at least this wide shape the object (earbuds) and are kept

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--mode", choices=["preview", "final"], default="preview")
ap.add_argument("--samples", type=int, default=None, help="override samples")
ap.add_argument("--verify", action="store_true",
                help="also render the full scene and compare it with background + layers")
args = ap.parse_args(argv)

MODES = {
    "preview": dict(res=(1050, 500), samples=32, bg="desk3d/renders/preview-bg.png",
                    layers="desk3d/renders/preview-layers", fmt="PNG"),
    "final": dict(res=(4200, 2000), samples=256, bg="public/desk/scene.jpg",
                  layers="public/desk/layers", fmt="JPEG", copy="desk3d/renders/final-bg.jpg"),
}
MODE = MODES[args.mode]
W, H = MODE["res"]
assert abs(W / H - ASPECT) < 0.01

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


PRINT_WINDOW = (0.144, 0.096)  # photo area on the print, meters (3:2)


def photo_material():
    m = bpy.data.materials.new("photo")
    b = _bsdf(m)
    tex = m.node_tree.nodes.new("ShaderNodeTexImage")
    img = bpy.data.images.load(os.path.join(ROOT, PHOTO["path"]))
    tex.image = img
    tex.extension = "CLIP"
    m.node_tree.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.35
    iw, ih = img.size
    if PHOTO["crop"]:
        l, t, r, btm = PHOTO["crop"]
    else:  # center-crop the whole image to the print window's aspect
        want = PRINT_WINDOW[0] / PRINT_WINDOW[1]
        if iw / ih > want:
            cw = ih * want
            l, t, r, btm = (iw - cw) / 2, 0, (iw + cw) / 2, ih
        else:
            ch = iw / want
            l, t, r, btm = 0, (ih - ch) / 2, iw, (ih + ch) / 2
    return m, (l / iw, 1 - btm / ih, r / iw, 1 - t / ih)


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
}
M["photo"], PHOTO_UV = photo_material()
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
        mod = ob.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel if bevel >= SHAPE_BEVEL else min(bevel, BEVEL_CAP)
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


FRAME_H = FRAME_W / ASPECT


def at(fx, fy):
    """Image fractions (from the top-left) -> world XY on the desk."""
    return ((fx - 0.5) * FRAME_W, (0.5 - fy) * FRAME_H)


def empty(name, fxy, rot_z_deg):
    ob = bpy.data.objects.new(name, None)
    coll.objects.link(ob)
    ob.location = (*at(*fxy), 0)
    ob.rotation_euler = (0, 0, math.radians(rot_z_deg))
    return ob


FONT_PATH = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
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
# Desk and objects. Positions are image fractions (x, y from the top-left);
# rotations are the original ones.
# ---------------------------------------------------------------------------
make_obj("desk", rbox(6, 6, 0.04), M["desk"], loc=(0, 0, -0.04), smooth=False)

CLICKABLE = {}  # id -> root object (each also gets its own layer)
DECOR = {}      # id -> root object (kept fully visible; the earbuds also get a layer)
LAYERED_DECOR = ("earbuds",)

# Laptop: base 30.4 x 21.2 cm, lid opened to ~125 deg -------------------------
laptop = empty("laptop", (0.605, 0.40), -18)
CLICKABLE["laptop"] = laptop
BW, BD, BH = 0.304, 0.212, 0.011
make_obj("laptop_base", rbox(BW, BD, BH, 0.012), M["silver"], laptop, bevel=0.002)
make_obj("keyboard", rbox(0.266, 0.104, 0.0006, 0.006), M["keys"], laptop, loc=(0, 0.036, BH), bevel=0.0002)
make_obj("trackpad", rbox(0.118, 0.072, 0.0004, 0.006), M["trackpad"], laptop, loc=(0, -0.058, BH), bevel=0.0002)
hinge = bpy.data.objects.new("laptop_hinge", None)
coll.objects.link(hinge)
hinge.parent = laptop
hinge.location = (0, BD / 2 - 0.002, BH)
hinge.rotation_euler = (math.radians(58), 0, 0)  # lift the lid 58 deg up from flat-open
LW, LD, LH = 0.304, 0.206, 0.006
make_obj("lid", rbox(LW, LD, LH, 0.012), M["silver"], hinge, loc=(0, LD / 2, -LH), bevel=0.002)
make_obj("bezel", rbox(0.296, 0.198, 0.0006, 0.009), M["black_gloss"], hinge, loc=(0, LD / 2, 0), bevel=0.0002)
make_obj("screen", rbox(0.278, 0.176, 0.0004, 0.002), M["screen"], hinge, loc=(0, LD / 2 + 0.004, 0.0006))

# Phone ---------------------------------------------------------------------
phone = empty("phone", (0.80, 0.27), 18)
CLICKABLE["phone"] = phone
make_obj("phone_body", rbox(0.072, 0.150, 0.008, 0.011), M["silver"], phone, bevel=0.0015)
make_obj("phone_screen", rbox(0.066, 0.143, 0.0004, 0.009), M["black_gloss"], phone, loc=(0, 0, 0.008))

# Notebook ------------------------------------------------------------------
notebook = empty("notebook", (0.23, 0.65), 13)
CLICKABLE["notebook"] = notebook
make_obj("notebook_pages", rbox(0.142, 0.204, 0.016, 0.003), M["paper"], notebook, loc=(0.002, 0, 0), bevel=0.0008)
make_obj("notebook_cover_bottom", rbox(0.148, 0.210, 0.002, 0.004), M["black"], notebook, bevel=0.0006)
make_obj("notebook_cover_top", rbox(0.148, 0.210, 0.002, 0.004), M["black"], notebook, loc=(0, 0, 0.016), bevel=0.0006)
make_obj("notebook_label", rbox(0.070, 0.026, 0.0004, 0.002), M["white"], notebook, loc=(0, 0.055, 0.018))
text("notebook_text", NOTEBOOK_LABEL, 0.0112, notebook, (0, 0.055, 0.0186), M["ink"], spacing=1.15)

# Badge + lanyard -------------------------------------------------------------
badge = empty("badge", (0.225, 0.34), -8)
CLICKABLE["badge"] = badge
make_obj("badge_card", rbox(0.056, 0.086, 0.0016, 0.004), M["white"], badge, bevel=0.0004)
make_obj("badge_band", rbox(0.056, 0.016, 0.0003, 0.0), M["blue"], badge, loc=(0, 0.033, 0.0016))
make_obj("badge_slot", rbox(0.014, 0.003, 0.0003, 0.0015), M["silver_dark"], badge, loc=(0, 0.037, 0.0019))
make_obj("badge_clip", rbox(0.010, 0.016, 0.003, 0.003), M["silver"], badge, loc=(0, 0.049, 0.0), bevel=0.0008)
text("badge_text", "JINGWEN WANG", 0.0054, badge, (0, -0.012, 0.0017), M["ink"], spacing=1.1)
bpy.context.view_layer.update()
clip = (badge.matrix_world @ Vector((0, 0.056, 0))).xy
edge_x = at(0, 0)[0] - 0.05  # starts past the left edge of the render
LANYARDS = []
for i, (dy0, dy1) in enumerate(((0.065, 0.030), (-0.010, 0.010))):
    pts = [(edge_x, clip.y + dy0), (edge_x + 0.13, clip.y + dy0 + 0.004),
           (clip.x - 0.06, clip.y + dy1), clip[:]]
    LANYARDS.append(solidify(make_obj(f"lanyard_{i}", ribbon(pts, 0.010, z=0.0002 + i * 0.0012),
                                      M["lanyard"], smooth=False), 0.0008))

# Print (4x6-ish, white border, slightly tilted) ------------------------------
pr = empty("print", (0.41, 0.72), -9)
CLICKABLE["print"] = pr
make_obj("print_paper", rbox(0.160, 0.122, 0.0008, 0.0015), M["paper"], pr)
make_obj("print_photo", plane_uv(*PRINT_WINDOW, PHOTO_UV), M["photo"], pr, loc=(0, 0.005, 0.00085), smooth=False)

# Palette + brush -------------------------------------------------------------
palette = empty("palette", (0.555, 0.765), 0)
CLICKABLE["palette"] = palette
make_obj("palette_dish", cylinder(0.05, 0.008), M["ceramic"], palette, bevel=0.0015)
for i, c in enumerate(WATERCOLORS):
    if i == 0:
        x, y = 0.0, 0.0
    else:
        a = math.radians(90 + (i - 1) * 60)
        x, y = 0.029 * math.cos(a), 0.029 * math.sin(a)
    make_obj(f"paint_{i}", cylinder(0.0105, 0.0006), material(f"paint_{i}", c, rough=0.5), palette, loc=(x, y, 0.008))
brush = empty("brush", (0.65, 0.775), 20)
DECOR["brush"] = brush
along_x = (0, math.radians(90), 0)  # cylinders then span [loc.x, loc.x + h] along +X
make_obj("brush_handle", cylinder(0.0028, 0.12, 32), M["wood"], brush, loc=(-0.045, 0, 0.003), rot=along_x)
make_obj("brush_ferrule", cylinder(0.0031, 0.018, 32), M["silver"], brush, loc=(-0.063, 0, 0.003), rot=along_x)
make_obj("brush_tip", cylinder(0.0026, 0.014, 32), M["brush_tip"], brush, loc=(-0.077, 0, 0.003), rot=along_x)

# Paper (A4) ----------------------------------------------------------------------
paper = empty("paper", (0.78, 0.66), 16)
CLICKABLE["paper"] = paper
make_obj("paper_sheet", rbox(0.210, 0.297, 0.0004), M["paper"], paper, smooth=False)
for i in range(9):
    make_obj(f"paper_line_{i}", rbox(0.150 if i % 3 else 0.090, 0.0016, 0.0001), M["line"], paper,
             loc=(-0.02 if i % 3 == 0 else 0, 0.11 - i * 0.02, 0.0004), smooth=False)

# Earbuds case (decor) ----------------------------------------------------------
buds = empty("earbuds", (0.385, 0.45), -25)
DECOR["earbuds"] = buds
make_obj("earbuds_case", rbox(0.050, 0.044, 0.022, 0.016), M["white_gloss"], buds, bevel=0.007)

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

scene.render.resolution_x, scene.render.resolution_y = W, H
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.view_settings.exposure = 0.0
scene.render.use_compositing = False

# ---------------------------------------------------------------------------
# Footprints (image fractions from the top-left)
# ---------------------------------------------------------------------------
bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()


def meshes(root):
    return [ob for ob in [root, *root.children_recursive] if ob.type in {"MESH", "FONT"}]


def project(p):
    c = world_to_camera_view(scene, cam, p)
    return Vector((c.x, 1 - c.y))


def world_points(objs):
    pts = []
    for ob in objs:
        ev = ob.evaluated_get(depsgraph)
        me = ev.to_mesh()
        pts.extend(ob.matrix_world @ v.co for v in me.vertices)
        ev.to_mesh_clear()
    return pts


def quad(objs, frame):
    """Bounding box of objs in `frame`'s XY axes, as 4 image-space corners."""
    inv = frame.inverted()
    loc = [inv @ p for p in world_points(objs)]
    xs, ys = [p.x for p in loc], [p.y for p in loc]
    return [tuple(project(frame @ Vector((x, y, 0))))
            for x, y in ((min(xs), min(ys)), (max(xs), min(ys)), (max(xs), max(ys)), (min(xs), max(ys)))]


def pixel_box(objs, pad=3):
    """Axis-aligned pixel box (x0, y0, x1, y1), y from the top, padded."""
    pts = [project(p) for p in world_points(objs)]
    x0 = max(0, math.floor(min(p.x for p in pts) * W) - pad)
    y0 = max(0, math.floor(min(p.y for p in pts) * H) - pad)
    x1 = min(W, math.ceil(max(p.x for p in pts) * W) + pad)
    y1 = min(H, math.ceil(max(p.y for p in pts) * H) + pad)
    return x0, y0, x1, y1


def hotspot(root):
    q = quad(meshes(root), root.matrix_world)
    px = [Vector((x * W, y * H)) for x, y in q]
    w_px = (px[1] - px[0]).length
    h_px = (px[2] - px[1]).length
    cx = sum(p.x for p in px) / 4
    cy = sum(p.y for p in px) / 4
    return {
        "left": round((cx - w_px / 2) / W * 100, 3),
        "top": round((cy - h_px / 2) / H * 100, 3),
        "width": round(w_px / W * 100, 3),
        "height": round(h_px / H * 100, 3),
        "rotate": round(-math.degrees(root.matrix_world.to_euler().z), 1),  # CSS rotate is clockwise
        "corners": q,
    }


spots = {k: hotspot(v) for k, v in CLICKABLE.items()}
shapes = {k: s["corners"] for k, s in spots.items()}
for k, root in DECOR.items():
    shapes[k] = quad(meshes(root), root.matrix_world)

# ---------------------------------------------------------------------------
# Layout checks (run on every render)
# ---------------------------------------------------------------------------
def overlaps(a, b):
    """Separating-axis test for two convex quads."""
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


def inside(q, r):
    x0, y0, _, _ = r[0][0], r[0][1], None, None
    x1, y1 = r[2]
    return all(x0 <= x <= x1 and y0 <= y <= y1 for x, y in q)


# Page layout, CSS px (see app/globals.css and app/page.tsx). The scene box has
# the render's aspect and covers the window (cover-fit, centered).
TITLE = dict(left=36, top=28, width=560, height=56)   # "Hello! I'm Jingwen Wang."
MODE_BTN = dict(right=36, top=32, width=120, height=34)
DOCK = dict(width=720, height=46, bottom=20)
PAD = 14      # keep objects this far from UI
EDGE = 10     # and from the window edge


def viewports():
    out = []
    for a in (16 / 10, 16 / 9, 2.0, 21 / 9):
        h_lo, h_hi = max(800, 1280 / a), min(1440, 2560 / a)
        for h in (h_lo, (h_lo + h_hi) / 2, h_hi):
            out.append((round(h * a), round(h)))
    return out


def to_scene(vw, vh, x0, y0, x1, y1):
    sw, sh = max(vw, vh * ASPECT), max(vh, vw / ASPECT)
    ox, oy = (sw - vw) / 2, (sh - vh) / 2
    return rect((x0 + ox) / sw, (y0 + oy) / sh, (x1 + ox) / sw, (y1 + oy) / sh)


problems = []
for vw, vh in viewports():
    visible = to_scene(vw, vh, EDGE, EDGE, vw - EDGE, vh - EDGE)
    ui = {
        "title": to_scene(vw, vh, TITLE["left"] - PAD, TITLE["top"] - PAD,
                          TITLE["left"] + TITLE["width"] + PAD, TITLE["top"] + TITLE["height"] + PAD),
        "reading-mode button": to_scene(vw, vh, vw - MODE_BTN["right"] - MODE_BTN["width"] - PAD, MODE_BTN["top"] - PAD,
                                        vw - MODE_BTN["right"] + PAD, MODE_BTN["top"] + MODE_BTN["height"] + PAD),
        "dock": to_scene(vw, vh, (vw - DOCK["width"]) / 2 - PAD, vh - DOCK["bottom"] - DOCK["height"] - PAD,
                         (vw + DOCK["width"]) / 2 + PAD, vh - DOCK["bottom"] + PAD),
    }
    for k, q in shapes.items():
        if not inside(q, visible):
            problems.append(f"{k} cut off at {vw}x{vh}")
        for name, r in ui.items():
            if overlaps(q, r):
                problems.append(f"{k} under {name} at {vw}x{vh}")
names = list(shapes)
for i, a in enumerate(names):
    for b in names[i + 1:]:
        if overlaps(shapes[a], shapes[b]):
            problems.append(f"{a} overlaps {b}")
print(f"[desk3d] layout check ({len(viewports())} viewports, 16:10-21:9, 1280x800-2560x1440):",
      problems or "ok")

if os.environ.get("DESK3D_CHECK_ONLY"):
    for k, q in shapes.items():  # bounds, image fractions from the top-left
        print(f"  {k:9s} x {min(p[0] for p in q):.3f}-{max(p[0] for p in q):.3f}"
              f"  y {min(p[1] for p in q):.3f}-{max(p[1] for p in q):.3f}")
    sys.exit(0)

# ---------------------------------------------------------------------------
# Renders: background (layered objects hidden from the camera, shadows kept),
# then each layered object alone on a transparent background, cropped
# ---------------------------------------------------------------------------
LAYER_ROOTS = {**CLICKABLE, **{k: DECOR[k] for k in LAYERED_DECOR}}
layered_objs = {k: meshes(v) for k, v in LAYER_ROOTS.items()}
all_meshes = [ob for ob in scene.objects if ob.type in {"MESH", "FONT"}]


def camera_visible(objs):
    for ob in all_meshes:
        ob.visible_camera = ob in objs


def render_to(path, fmt, transparent=False, box=None):
    scene.render.film_transparent = transparent
    scene.render.use_border = box is not None
    scene.render.use_crop_to_border = box is not None
    if box:
        x0, y0, x1, y1 = box
        # border is from the bottom-left; +0.25 px keeps rounding on the right pixel
        scene.render.border_min_x = (x0 + 0.25) / W
        scene.render.border_max_x = (x1 + 0.25) / W
        scene.render.border_min_y = (H - y1 + 0.25) / H
        scene.render.border_max_y = (H - y0 + 0.25) / H
    s = scene.render.image_settings
    s.file_format = fmt
    s.color_mode = "RGBA" if transparent else "RGB"
    if fmt == "JPEG":
        s.quality = 90
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def abs_path(rel):
    p = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


# Background, in two passes so the desk under each object isn't a black hole
# (it never gets light). Pass 1 keeps the shadows the objects cast; pass 2 is the
# desk with those objects gone. Pixels the object covers completely are taken
# from pass 2, slightly darkened; partly covered edge pixels stay from pass 1,
# so background + layers still matches the full render exactly. While a layer
# is loading, or lifts on hover, you see a soft shade instead of black.
import numpy as np

UNDER_SHADE = 0.82
tmp_dir = abs_path("desk3d/renders/tmp/x")
tmp_dir = os.path.dirname(tmp_dir)
layered_flat = [ob for objs in layered_objs.values() for ob in objs]

camera_visible([ob for ob in all_meshes if ob not in layered_flat])
shadow_path = os.path.join(tmp_dir, "bg-shadows.png")
render_to(shadow_path, "PNG")

for ob in layered_flat:
    ob.hide_render = True
clean_path = os.path.join(tmp_dir, "bg-clean.png")
render_to(clean_path, "PNG")
for ob in layered_flat:
    ob.hide_render = False

# layers
layers = {}
layer_dir = os.path.dirname(abs_path(os.path.join(MODE["layers"], "x")))
for k, objs in layered_objs.items():
    box = pixel_box(objs)
    camera_visible(objs)
    path = os.path.join(layer_dir, f"{k}.png")
    render_to(path, "PNG", transparent=True, box=box)
    img = bpy.data.images.load(path, check_existing=False)
    got = tuple(img.size)
    bpy.data.images.remove(img)
    want = (box[2] - box[0], box[3] - box[1])
    if got != want:
        print(f"[desk3d] WARNING layer {k}: size {got} != expected {want}")
    layers[k] = box
camera_visible(all_meshes)
scene.render.use_border = False


def load(p):
    im = bpy.data.images.load(p, check_existing=False)
    a = np.array(im.pixels[:], dtype=np.float32).reshape(im.size[1], im.size[0], im.channels)
    bpy.data.images.remove(im)
    return a[::-1]  # top row first


bg = load(shadow_path)[..., :3].copy()
clean = load(clean_path)[..., :3]
for k, (x0, y0, x1, y1) in layers.items():
    full = load(os.path.join(layer_dir, f"{k}.png"))[..., 3] > 0.995
    region = bg[y0:y1, x0:x1]
    region[full] = clean[y0:y1, x0:x1][full] * UNDER_SHADE

bg_path = abs_path(MODE["bg"])
out = bpy.data.images.new("bg", W, H, alpha=False)
out.pixels.foreach_set(np.concatenate([bg[::-1], np.ones((H, W, 1), np.float32)], axis=2).ravel())
out.file_format = MODE["fmt"]
out.save(filepath=bg_path, quality=90)
bpy.data.images.remove(out)
if MODE.get("copy"):
    shutil.copyfile(bg_path, abs_path(MODE["copy"]))
shutil.rmtree(tmp_dir, ignore_errors=True)

print("[desk3d] rendered", bg_path, "and", len(layers), "layers in", layer_dir)

# ---------------------------------------------------------------------------
# --verify: full render vs background + layers
# ---------------------------------------------------------------------------
if args.verify:
    full_path = abs_path("desk3d/renders/preview-full.png")
    render_to(full_path, "PNG")

    comp = load(bg_path)[..., :3].copy()
    for k, (x0, y0, x1, y1) in layers.items():
        lay = load(os.path.join(layer_dir, f"{k}.png"))
        a = lay[..., 3:4]
        comp[y0:y1, x0:x1] = lay[..., :3] * a + comp[y0:y1, x0:x1] * (1 - a)
    diff = np.abs(comp - load(full_path)[..., :3]) * 255
    print(f"[desk3d] verify: mean diff {diff.mean():.2f}/255, "
          f"99th pct {np.percentile(diff, 99):.1f}, max {diff.max():.1f}")

# ---------------------------------------------------------------------------
# Hotspots + layer boxes -> app/desk-hotspots.json (final renders only: it
# points at the files in public/)
# ---------------------------------------------------------------------------
def pct(v, total):
    return round(v / total * 100, 3)


if args.mode == "final":
    data = {
        "image": {"w": W, "h": H, "src": "/desk/scene.jpg"},
        "hotspots": [
            {"id": k, **{kk: vv for kk, vv in s.items() if kk != "corners"},
             **({"round": True} if k == "palette" else {})}
            for k, s in spots.items()
        ],
        "layers": [
            {"id": k, "src": f"/desk/layers/{k}.png", "clickable": k in CLICKABLE,
             "left": pct(x0, W), "top": pct(y0, H), "width": pct(x1 - x0, W), "height": pct(y1 - y0, H)}
            for k, (x0, y0, x1, y1) in layers.items()
        ],
    }
    hot_path = os.path.join(ROOT, "app/desk-hotspots.json")
    with open(hot_path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    print("[desk3d] wrote", hot_path)
