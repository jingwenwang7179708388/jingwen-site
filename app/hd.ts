// 物件的高清版本（desk3d/scene.py --hd 渲染，public/desk/hd/<id>.webp）。
// 和普通物件层同一个裁切框、同样的朝向，只是分辨率更高，放大推进时换上去不会错位。
// 首屏不加载；页面加载完、浏览器空闲时逐张预加载，鼠标悬停的那个优先。

export const hdSrc = (id: string) => `/desk/hd/${id}.webp`;

const pending = new Map<string, Promise<boolean>>();
const ready = new Set<string>();
const keep: HTMLImageElement[] = []; // 留着引用，解码结果不被回收

export const hdReady = (id: string) => ready.has(id);

// 返回是否加载成功（失败就一直用普通版本）
export function loadHd(id: string, urgent = false): Promise<boolean> {
  let p = pending.get(id);
  if (!p) {
    const img = new Image();
    img.decoding = "async";
    if (urgent) img.fetchPriority = "high";
    img.src = hdSrc(id);
    keep.push(img);
    p = img
      .decode()
      .then(() => {
        ready.add(id);
        return true;
      })
      .catch(() => false);
    pending.set(id, p);
  }
  return p;
}

// 首屏加载完成后，空闲时一张一张地预加载（不和首屏抢带宽）
export function preloadHd(ids: string[]) {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return () => {};
  let stopped = false;
  // Safari 没有 requestIdleCallback
  const idle = (fn: () => void) =>
    typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback(fn, { timeout: 3000 })
      : setTimeout(fn, 200);
  const next = async (i: number) => {
    if (stopped || i >= ids.length) return;
    await loadHd(ids[i]);
    idle(() => next(i + 1));
  };
  const start = () => idle(() => next(0));
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
  return () => {
    stopped = true;
    window.removeEventListener("load", start);
  };
}
