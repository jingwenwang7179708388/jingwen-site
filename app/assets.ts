// ====== 生成好的素材都登记在这里 ======
// 文件放进 public/ 下对应的文件夹，然后把路径填进来。
// 没填的地方不显示，不会出现破图。

export type Img = { src: string; w: number; h: number; alt?: string };

export type DeskAsset = {
  image?: Img; // 透明背景 PNG/WebP（抠好的物件）
  video?: string; // 鼠标悬停时播放的 2–3 秒循环小视频（webm 或 mp4，最好 < 1MB）
};

// key 对应 page.tsx 里每个物件的 id
// 单独物件图已取消登记：书桌现在是一整张场景图 + 透明点击区域（见 page.tsx 的 HOTSPOTS）
export const DESK_ASSETS: Record<string, DeskAsset> = {};

// 整张书桌的场景图（Blender 渲染，16:10），全屏铺满。由 desk3d/scene.py --mode final 生成
export const DESK_BACKGROUND: Img | null = { src: "/desk/scene.jpg", w: 3840, h: 2400 };

// ====== photo-to-short 项目页 ======
export const DEMO = {
  video: "", // 成片，比如 "/demo/short-01.mp4"
  poster: "", // 视频封面，比如 "/demo/short-01.jpg"
  gradio: "", // HF Space 的嵌入地址，比如 "https://xxx.hf.space"
  repo: "", // GitHub repo 链接
  // 输入照片 + 三张关键帧，用来展示流程（可选）
  steps: [] as Img[],
};

// ====== "How this desk was made" 窗口里的过程图 ======
// 比如：prompt 截图、LoRA 前/后对比、抠图前后、视频截帧
export const MAKING: (Img & { caption: string })[] = [];

// ====== 摄影作品 ======
// 放进 public/photos/，建议 6–9 张，长边 1600px 左右
export const PHOTOS: Img[] = [];

// 是否已经换上了生成素材（决定要不要显示 "how this desk was made" 入口）
export const HAS_GENERATED_DESK =
  DESK_BACKGROUND !== null ||
  Object.values(DESK_ASSETS).some((a) => a.image || a.video);
