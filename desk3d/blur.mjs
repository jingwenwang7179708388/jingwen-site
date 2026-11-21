// 预先生成"虚化"用的小图，让点开物件时的虚化只靠淡入替换（只动 opacity，保持 60fps）：
//   public/desk/blur/bg-<id>.webp   背景 + 除 <id> 以外的所有物件，缩小并模糊（bg-all：所有物件都在）
//   public/desk/blur/layer-<id>.webp  单个物件，按推进后的大小模糊（四周留透明边，模糊不被切掉）
// 位置写进 app/desk-blur.json。重新渲染书桌（desk3d/scene.py）后要重新跑：
//   node desk3d/blur.mjs
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const desk = JSON.parse(fs.readFileSync(path.join(root, "app/desk-hotspots.json"), "utf8"));
const pub = (p) => path.join(root, "public", p);
const outDir = pub("desk/blur");
fs.mkdirSync(outDir, { recursive: true });

const BLUR_CSS = 12; // 页面上的虚化半径（CSS px，对应 blur(12px)）
const REF = { vw: 1440, vh: 900 }; // 按这个窗口换算模糊半径
const ZOOM_H = 0.8; // 推进后物件占窗口高度（和 app/page.tsx 的 ZOOM_H 一致）
const ZOOM_W = 0.9;

const { w: W, h: H } = desk.image;
const core = desk.core;
const ar = W / H;
// 参考窗口下场景的 CSS 宽度（和 page.tsx 的 --scene-w 一样）
const sceneW = Math.min(REF.vw / (core.width / 100), (REF.vh * ar) / (core.height / 100));
const sceneH = sceneW / ar;

// ---- 背景 ----
const BG_W = 1600;
const k = BG_W / W;
const bgSigma = BLUR_CSS * (BG_W / sceneW);
const bgH = Math.round(H * k);
const base = await sharp(pub(desk.image.src.slice(1))).resize(BG_W, bgH).toBuffer();
const layerImgs = {};
for (const l of desk.layers) {
  const w = Math.max(1, Math.round((l.width / 100) * BG_W));
  const h = Math.max(1, Math.round((l.height / 100) * bgH));
  layerImgs[l.id] = {
    input: await sharp(pub(l.src.slice(1))).resize(w, h, { fit: "fill" }).png().toBuffer(),
    left: Math.round((l.left / 100) * BG_W),
    top: Math.round((l.top / 100) * bgH),
  };
}
const manifest = { bg: {}, layers: {} };
const variants = ["all", ...desk.layers.filter((l) => l.clickable).map((l) => l.id)];
for (const v of variants) {
  const parts = desk.layers.filter((l) => l.id !== v).map((l) => layerImgs[l.id]);
  const file = `desk/blur/bg-${v}.webp`;
  const composed = await sharp(base).composite(parts).png().toBuffer();
  await sharp(composed).blur(bgSigma).webp({ quality: 72 }).toFile(pub(file));
  manifest.bg[v] = `/${file}`;
}

// ---- 推进后的单个物件 ----
const OUT_H = 520;
for (const l of desk.layers.filter((x) => x.clickable)) {
  const hs = desk.hotspots.find((h) => h.id === l.id);
  const ow = (hs.width / 100) * sceneW;
  const oh = (hs.height / 100) * sceneH;
  const s = Math.min((ZOOM_H * REF.vh) / oh, (ZOOM_W * REF.vw) / ow);
  const shownH = (l.height / 100) * sceneH * s; // 推进后图层框的 CSS 高度
  const outH = OUT_H;
  const outW = Math.round(OUT_H * ((l.width / 100) * W) / ((l.height / 100) * H));
  const sigma = BLUR_CSS * (outH / shownH);
  const pad = Math.ceil(sigma * 3);
  const file = `desk/blur/layer-${l.id}.webp`;
  const img = await sharp(pub(l.src.slice(1)))
    .resize(outW, outH, { fit: "fill" })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp(img).blur(sigma).webp({ quality: 75, alphaQuality: 80 }).toFile(pub(file));
  manifest.layers[l.id] = { src: `/${file}`, padX: +(pad / outW).toFixed(4), padY: +(pad / outH).toFixed(4) };
}

fs.writeFileSync(path.join(root, "app/desk-blur.json"), JSON.stringify(manifest, null, 2) + "\n");
const size = fs.readdirSync(outDir).reduce((a, f) => a + fs.statSync(path.join(outDir, f)).size, 0);
console.log(`[blur] bg sigma ${bgSigma.toFixed(1)}px @${BG_W}w, ${variants.length} backgrounds + ${Object.keys(manifest.layers).length} layers, ${(size / 1024).toFixed(0)} KB`);
