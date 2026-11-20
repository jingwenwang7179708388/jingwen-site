"""Build and render the 3D desk scene for the site's home page.

    Blender -b -P desk3d/scene.py -- --mode preview              # 960x600, low samples, graded
    Blender -b -P desk3d/scene.py -- --mode preview --no-grade   # same light, no color grading
    Blender -b -P desk3d/scene.py -- --mode final                # 3840x2400 -> public/desk/scene.jpg
    add --no-glass to leave out the glass of water

Units are meters. World +X is image right, +Y is image up, the desk top is z = 0.
Besides the render, the script projects every clickable object's bounding box
onto the camera and writes app/desk-hotspots.json for page.tsx.
"""

import argparse
import json
import math
import os
import sys

import bmesh
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--mode", choices=["preview", "final"], default="preview")
ap.add_argument("--no-grade", action="store_true", help="skip the compositor color grade")
ap.add_argument("--no-glass", action="store_true", help="leave out the glass of water")
ap.add_argument("--exposure", type=float, default=None, help="override for tuning")
ap.add_argument("--border", default=None, help="tuning: render only x0,y0,x1,y1 (fractions, from bottom-left)")
ap.add_argument("--samples", type=int, default=None, help="tuning: override samples")
ap.add_argument("--caster", default="all", choices=["all", "water"], help="tuning: which glass parts cast caustics")
ap.add_argument("--out", default=None, help="tuning: override output path")
args = ap.parse_args(argv)

MODES = {
    "preview": dict(res=(960, 600), samples=48, out="desk3d/renders/preview.png", fmt="PNG"),
    "final": dict(res=(3840, 2400), samples=256, out="public/desk/scene.jpg", fmt="JPEG"),
}
MODE = dict(MODES[args.mode])
if args.no_grade:
    MODE["out"] = MODE["out"].replace(".png", "-nograde.png").replace(".jpg", "-nograde.jpg")

EXPOSURE = 2.5 if args.exposure is None else args.exposure

# Frame: orthographic, 0.9 m wide, 16:10
FRAME_W = 0.9

FONT_PATH = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
PHOTO_PATH = os.path.join(ROOT, "public/desk/oldphoto.webp")
# oldphoto.webp is a scan with album borders; the photo itself sits in this
# pixel box (972 x 770 image). Aspect 873:580 ~ 1.5, same as the print window.
PHOTO_IMG = (972, 770)
PHOTO_BOX = (62, 80, 935, 660)  # left, top, right, bottom

# Sun: low from the left, slightly from the bottom of the frame
SUN_ELEVATION = 30
SUN_AZIMUTH_BELOW = 15  # degrees below the left direction
SUN_ANGLE = 3

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


def desk_material():
    """Matte white with a very fine surface texture."""
    m = material("desk", "#f2f2f0", rough=0.6)
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    coord = nt.nodes.new("ShaderNodeTexCoord")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 900
    noise.inputs["Detail"].default_value = 2
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.04
    bump.inputs["Distance"].default_value = 0.0004
    nt.links.new(coord.outputs["Object"], noise.inputs["Vector"])
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def screen_material():
    """Very soft, nearly neutral light-gray gradient."""
    m = bpy.data.materials.new("screen")
    b = _bsdf(m)
    nt = m.node_tree
    coord = nt.nodes.new("ShaderNodeTexCoord")
    grad = nt.nodes.new("ShaderNodeTexGradient")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*srgb("#eceef0"), 1)
    ramp.color_ramp.elements[1].color = (*srgb("#cfd4d9"), 1)
    nt.links.new(coord.outputs["Generated"], grad.inputs["Vector"])
    nt.links.new(grad.outputs["Color"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
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
    "desk": desk_material(),
    "silver": material("silver", "#d8d9db", rough=0.42, metal=0.25),
    "silver_dark": material("silver_dark", "#b4b6b9", rough=0.42, metal=0.25),
    "keys": material("keys", "#2a2b2d", rough=0.65, **{"Specular IOR Level": 0.3}),
    "trackpad": material("trackpad", "#e2e3e4", rough=0.5, metal=0.1),
    # deep, matte blacks with a soft highlight
    "black": material("black", "#0b0b0c", rough=0.55, **{"Specular IOR Level": 0.15}),
    "screen_black": material("screen_black", "#08080a", rough=0.62, **{"Specular IOR Level": 0.15}),
    "white": material("white", "#f7f7f5", rough=0.55),
    "white_gloss": material("white_gloss", "#fbfbfa", rough=0.3),
    "paper": material("paper", "#fbfbf9", rough=0.8),
    "line": material("line", "#dcdcd8", rough=0.8),
    "lanyard": material("lanyard", "#c4c5c7", rough=0.85),
    "ink": material("ink", "#222222", rough=0.6),
    "blue": material("blue", "#8fb6dc", rough=0.6),
    "ceramic": material("ceramic", "#f6f6f3", rough=0.3),
    "glass": material("glass", "#ffffff", rough=0.0, **{"Transmission Weight": 1.0, "IOR": 1.5}),
    "water": material("water", "#ffffff", rough=0.0, **{"Transmission Weight": 1.0, "IOR": 1.33}),
    "screen": screen_material(),
    "photo": photo_material(),
}
# muted watercolors: the photo and the badge band are the only real color
WATERCOLORS = ["#b2c2d0", "#d5c39f", "#cfaeab", "#b5c2b1", "#a8abaf", "#c7a996", "#bfb4c4"]

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
        # tiny edge bevels only: big ones catch the low sun and glow
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


def cylinder(r, h, segments=96, top=True, r_top=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments,
                          radius1=r, radius2=r if r_top is None else r_top, depth=h)
    for v in bm.verts:
        v.co.z += h / 2
    if not top:
        tops = [f for f in bm.faces if f.normal.z > 0.9]
        bmesh.ops.delete(bm, geom=tops, context="FACES_ONLY")
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


def world_xy(fx, fy):
    """Image fractions (from the top-left) -> world XY on the desk."""
    return ((fx - 0.5) * FRAME_W, (0.5 - fy) * FRAME_W * 10 / 16)


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


def caustics(ob, caster=False, receiver=False):
    try:
        ob.cycles.is_caustics_caster = caster
        ob.cycles.is_caustics_receiver = receiver
    except AttributeError:
        pass


# ---------------------------------------------------------------------------
# Desk
# ---------------------------------------------------------------------------
desk = make_obj("desk", rbox(4, 4, 0.04), M["desk"], loc=(0, 0, -0.04), smooth=False)
caustics(desk, receiver=True)

CLICKABLE = {}  # id -> root object

# Laptop: base 30.4 x 21.2 cm, lid opened to ~125 deg -------------------------
laptop = empty("laptop", world_xy(0.50, 0.40), -4)
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
make_obj("bezel", rbox(0.296, 0.198, 0.0006, 0.009), M["screen_black"], hinge, loc=(0, LD / 2, 0))
make_obj("screen", rbox(0.278, 0.176, 0.0004, 0.002), M["screen"], hinge, loc=(0, LD / 2 + 0.004, 0.0006))

# Phone ---------------------------------------------------------------------
phone = empty("phone", world_xy(0.80, 0.34), 7)
CLICKABLE["phone"] = phone
make_obj("phone_body", rbox(0.072, 0.150, 0.008, 0.011), M["silver"], phone, bevel=0.0006)
make_obj("phone_screen", rbox(0.066, 0.143, 0.0004, 0.009), M["screen_black"], phone, loc=(0, 0, 0.008))

# Notebook: partly cut off by the left edge ------------------------------------
notebook = empty("notebook", world_xy(0.055, 0.66), 4)
CLICKABLE["notebook"] = notebook
make_obj("notebook_pages", rbox(0.142, 0.204, 0.016, 0.003), M["paper"], notebook, loc=(0.002, 0, 0))
make_obj("notebook_cover_bottom", rbox(0.148, 0.210, 0.002, 0.004), M["black"], notebook, bevel=0.0004)
make_obj("notebook_cover_top", rbox(0.148, 0.210, 0.002, 0.004), M["black"], notebook, loc=(0, 0, 0.016), bevel=0.0004)
make_obj("notebook_label", rbox(0.058, 0.026, 0.0004, 0.002), M["white"], notebook, loc=(0.012, 0.055, 0.018))
text("notebook_text", "NOW", 0.0125, notebook, (0.012, 0.055, 0.0186), M["ink"], spacing=1.25)

# Badge (1.3x) + lanyard as a thin line from the left edge ---------------------
badge = empty("badge", world_xy(0.205, 0.45), -5, scale=1.3)
CLICKABLE["badge"] = badge
make_obj("badge_card", rbox(0.056, 0.086, 0.0016, 0.004), M["white"], badge, bevel=0.0004)
make_obj("badge_band", rbox(0.056, 0.016, 0.0003, 0.0), M["blue"], badge, loc=(0, 0.033, 0.0016))
make_obj("badge_slot", rbox(0.014, 0.003, 0.0003, 0.0015), M["silver_dark"], badge, loc=(0, 0.037, 0.0019))
make_obj("badge_clip", rbox(0.010, 0.016, 0.003, 0.003), M["silver"], badge, loc=(0, 0.049, 0.0), bevel=0.0006)
text("badge_text", "JINGWEN WANG", 0.0054, badge, (0, -0.012, 0.0017), M["ink"], spacing=1.1)
bpy.context.view_layer.update()
clip = (badge.matrix_world @ Vector((0, 0.056, 0))).xy
edge_y = world_xy(0, 0.25)[1]
for i, off in enumerate((-0.0035, 0.0035)):
    pts = [(-0.50, edge_y + off), (-0.40, edge_y - 0.012 + off),
           (clip.x - 0.035, clip.y + 0.012 + off * 0.6), (clip.x + off * 0.3, clip.y)]
    solidify(make_obj(f"lanyard_{i}", ribbon(pts, 0.0065, z=0.0002 + i * 0.0009), M["lanyard"], smooth=False), 0.0007)

# Print (4x6-ish, white border) -------------------------------------------------
pr = empty("print", world_xy(0.385, 0.72), 5)
CLICKABLE["print"] = pr
make_obj("print_paper", rbox(0.160, 0.122, 0.0008, 0.0015), M["paper"], pr)
pl, pt, prr, pb = PHOTO_BOX
iw, ih = PHOTO_IMG
make_obj("print_photo", plane_uv(0.144, 0.096, (pl / iw, 1 - pb / ih, prr / iw, 1 - pt / ih)),
         M["photo"], pr, loc=(0, 0.005, 0.00085), smooth=False)

# Palette: round dish with recessed wells ----------------------------------------
palette = empty("palette", world_xy(0.585, 0.73), 0)
CLICKABLE["palette"] = palette
DISH_H = 0.008
dish = make_obj("palette_dish", cylinder(0.05, DISH_H), M["ceramic"], palette, bevel=0.0006)
wells = []
for i in range(len(WATERCOLORS)):
    if i == 0:
        wells.append((0.0, 0.0))
    else:
        a = math.radians(90 + (i - 1) * 60)
        wells.append((0.029 * math.cos(a), 0.029 * math.sin(a)))
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
    paint = material(f"paint_{i}", c, rough=0.45)
    make_obj(f"paint_{i}", cylinder(0.0104, 0.0005, segments=48), paint, palette,
             loc=(x, y, DISH_H - 0.0028))

# Paper (A4, spilling off the bottom-right corner) ----------------------------
paper = empty("paper", world_xy(0.89, 0.80), 6)
CLICKABLE["paper"] = paper
make_obj("paper_sheet", rbox(0.210, 0.297, 0.0004), M["paper"], paper, smooth=False)
for i in range(9):
    make_obj(f"paper_line_{i}", rbox(0.150 if i % 3 else 0.090, 0.0016, 0.0001), M["line"], paper,
             loc=(-0.02 if i % 3 == 0 else 0, 0.11 - i * 0.02, 0.0004), smooth=False)

# Mechanical pencil (decor), ~35 deg next to the paper ----------------------------
pencil = empty("pencil", world_xy(0.715, 0.79), 35)
R = 0.0034
along_x = (0, math.radians(90), 0)  # cylinders then span [loc.x, loc.x + h] along +X
make_obj("pencil_body", cylinder(R, 0.130, 32), M["black"], pencil, loc=(-0.065, 0, R), rot=along_x)
make_obj("pencil_grip", cylinder(R * 1.08, 0.030, 32), M["black"], pencil, loc=(0.030, 0, R), rot=along_x)
make_obj("pencil_tip", cylinder(R, 0.012, 32, r_top=0.0009), M["silver"], pencil, loc=(0.065, 0, R), rot=along_x)
make_obj("pencil_lead", cylinder(0.00035, 0.003, 12), M["keys"], pencil, loc=(0.077, 0, R), rot=along_x)
make_obj("pencil_cap", cylinder(R * 0.9, 0.009, 32), M["silver"], pencil, loc=(-0.074, 0, R), rot=along_x)
make_obj("pencil_clip", rbox(0.032, 0.0018, 0.0012, 0.0008), M["silver"], pencil, loc=(-0.048, 0, 2 * R))

# Earbuds case (decor) ----------------------------------------------------------
buds = empty("earbuds", world_xy(0.24, 0.88), -8)
make_obj("earbuds_case", rbox(0.050, 0.044, 0.022, 0.016), M["white_gloss"], buds, bevel=0.0006)

# Optional: straight glass, half full of water (decor, casts caustics) ------------
if not args.no_glass:
    cup = empty("water_glass", world_xy(0.27, 0.24), 0)
    GR, GH = 0.033, 0.095
    wall = make_obj("glass_wall", cylinder(GR, GH, top=False), M["glass"], cup)
    solidify(wall, -0.0022)
    base = make_obj("glass_base", cylinder(GR - 0.0022, 0.006), M["glass"], cup)
    water = make_obj("water", cylinder(GR - 0.0023, 0.042), M["water"], cup, loc=(0, 0, 0.006))
    for ob in ((wall, base, water) if args.caster == "all" else (water,)):
        caustics(ob, caster=True)

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

sun_data = bpy.data.lights.new("sun", "SUN")
sun_data.energy = 8.0
sun_data.angle = math.radians(SUN_ANGLE)
try:
    sun_data.cycles.is_caustics_light = True
except AttributeError:
    pass
sun = bpy.data.objects.new("sun", sun_data)
coll.objects.link(sun)
el, az = math.radians(SUN_ELEVATION), math.radians(SUN_AZIMUTH_BELOW)
to_sun = Vector((-math.cos(el) * math.cos(az), -math.cos(el) * math.sin(az), math.sin(el)))
sun.rotation_euler = to_sun.to_track_quat("Z", "Y").to_euler()  # light travels along -Z

# Bright white fill: shadows only ~20% darker than the lit desk
world = bpy.data.worlds.new("world")
scene.world = world
if hasattr(world, "use_nodes") and not world.use_nodes:
    world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs["Color"].default_value = (1, 1, 1, 1)
bg.inputs["Strength"].default_value = 0.33
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
scene.cycles.max_bounces = 12
scene.cycles.transmission_bounces = 12
scene.cycles.caustics_refractive = True

scene.render.resolution_x, scene.render.resolution_y = MODE["res"]
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = "AgX"
scene.view_settings.exposure = EXPOSURE
bpy.context.view_layer.use_pass_ambient_occlusion = True

out_path = os.path.abspath(args.out) if args.out else os.path.join(ROOT, MODE["out"])
if args.border:
    x0, y0, x1, y1 = map(float, args.border.split(","))
    scene.render.use_border = True
    scene.render.use_crop_to_border = True
    scene.render.border_min_x, scene.render.border_min_y = x0, y0
    scene.render.border_max_x, scene.render.border_max_y = x1, y1
os.makedirs(os.path.dirname(out_path), exist_ok=True)
scene.render.filepath = out_path
scene.render.image_settings.file_format = MODE["fmt"]
scene.render.image_settings.color_mode = "RGB"
if MODE["fmt"] == "JPEG":
    scene.render.image_settings.quality = 90


# ---------------------------------------------------------------------------
# Color grade (compositor), applied on every render unless --no-grade
# ---------------------------------------------------------------------------
def set_look(view_settings, names):
    for look in names:
        try:
            view_settings.look = look
            return
        except TypeError:
            continue


LOW_CONTRAST = ("AgX - Medium Low Contrast", "Medium Low Contrast")


def build_grade():
    """Scene-linear fixes -> AgX (in the compositor) -> display-space grade.

    AgX is applied here with a Convert To Display node so the grade can work on
    what you actually see; the scene's own view transform is then Standard, and
    the last node inverts Standard, so the saved pixels equal the graded ones.
    """
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

    def to_display(img, view, invert=False, look=None, exposure=0.0):
        if exposure:
            ex = N.new("CompositorNodeExposure")
            ex.inputs["Exposure"].default_value = exposure
            L.new(img, ex.inputs["Image"])
            img = ex.outputs["Image"]
        n = N.new("CompositorNodeConvertToDisplay")
        n.view_settings.view_transform = view
        if look:
            set_look(n.view_settings, look)
        n.inputs["Invert"].default_value = invert
        L.new(img, n.inputs["Image"])
        return n.outputs["Image"]

    rl = N.new("CompositorNodeRLayers")
    img = rl.outputs["Image"]

    # --- scene-linear ---------------------------------------------------------
    # contact shadows / AO: objects sit on the desk
    img = mix("MULTIPLY", img, rl.outputs["Ambient Occlusion"], 0.22)

    # white balance: neutral, a touch cool (~6000-6500K)
    wb = N.new("CompositorNodeColorBalance")
    wb.inputs["Type"].default_value = "White Point"
    wb.inputs["Input Temperature"].default_value = 6150
    wb.inputs["Output Temperature"].default_value = 6500
    wb.inputs["Input Tint"].default_value = 10
    wb.inputs["Output Tint"].default_value = 10
    L.new(img, wb.inputs["Image"])
    img = wb.outputs["Image"]

    # saturation -20%
    hs = N.new("CompositorNodeHueSat")
    hs.inputs["Saturation"].default_value = 0.8
    L.new(img, hs.inputs["Image"])
    img = hs.outputs["Image"]

    # keep blacks black before AgX lifts them (scene-linear)
    lin_black = N.new("CompositorNodeCurveRGB")
    lin_black.inputs["Black Level"].default_value = (0.012, 0.012, 0.012, 1)
    L.new(img, lin_black.inputs["Image"])
    img = lin_black.outputs["Image"]

    # --- AgX ------------------------------------------------------------------
    img = to_display(img, "AgX", look=LOW_CONTRAST, exposure=EXPOSURE)

    # --- display space ----------------------------------------------------------
    # true blacks: the darkest few percent go to 0; mids stay soft
    curve = N.new("CompositorNodeCurveRGB")
    curve.inputs["Black Level"].default_value = (0.035, 0.035, 0.035, 1)
    L.new(img, curve.inputs["Image"])
    img = curve.outputs["Image"]

    # very light softening, like a phone photo
    blur = N.new("CompositorNodeBlur")
    blur.inputs["Size"].default_value = (max(1, W / 1900),) * 2
    L.new(img, blur.inputs["Image"])
    img = mix("MIX", img, blur.outputs["Image"], 0.45)

    # vignette: ~10% at most, strongest bottom-right
    coords = N.new("CompositorNodeImageCoordinates")
    L.new(rl.outputs["Image"], coords.inputs["Image"])  # gives the node the frame size
    dist = N.new("ShaderNodeVectorMath")
    dist.operation = "DISTANCE"
    L.new(coords.outputs["Normalized"], dist.inputs[0])
    dist.inputs[1].default_value = (0.42, 0.58, 0)  # off-center toward the top-left
    ramp = N.new("ShaderNodeMapRange")
    ramp.interpolation_type = "SMOOTHSTEP"
    ramp.inputs["From Min"].default_value = 0.35
    ramp.inputs["From Max"].default_value = 0.85
    ramp.inputs["To Min"].default_value = 1.0
    ramp.inputs["To Max"].default_value = 0.9
    L.new(dist.outputs["Value"], ramp.inputs["Value"])
    img = mix("MULTIPLY", img, ramp.outputs["Result"], 1.0)

    # very fine grain
    noise = N.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = W * 0.6
    noise.inputs["Detail"].default_value = 0
    L.new(coords.outputs["Normalized"], noise.inputs["Vector"])
    img = mix("OVERLAY", img, noise.outputs["Color"], 0.06)

    # back to linear for the Standard view transform -> pixels saved as graded
    img = to_display(img, "Standard", invert=True)

    out = N.new("NodeGroupOutput")
    L.new(img, out.inputs[0])
    return ng


if not args.no_grade:
    scene.compositing_node_group = build_grade()
    scene.render.use_compositing = True
    # the GPU (Metal) compositor skips the AgX in Convert To Display (Blender 5.3); CPU is correct
    scene.render.compositor_device = "CPU"
    scene.view_settings.view_transform = "Standard"  # AgX is applied inside the grade
    scene.view_settings.exposure = 0.0
else:
    scene.render.use_compositing = False

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
print("[desk3d] rendered", out_path)
