"use client";

import Image from "next/image";
import { useEffect, useEffectEvent, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "motion/react";
import { SECTIONS, type Section, type SectionId } from "./content";
import { HAS_GENERATED_DESK } from "./assets";
import { PanelBody } from "./panels";
import { useResume } from "./resume";
import { hdReady, hdSrc, loadHd, preloadHd } from "./hd";
import desk from "./desk-hotspots.json";
import blur from "./desk-blur.json"; // 虚化用的小图，由 desk3d/blur.mjs 生成

// ====== 书桌：背景图 + 每个物件单独一层 ======
// 都由 desk3d/scene.py 渲染并写进 app/desk-hotspots.json（数字是占图片宽高的百分比）：
//   image   背景图（没有可点击物件，但保留它们的阴影）
//   layers  每个物件的透明 PNG 和位置，叠在背景上和整张渲染图一样
//   hotspots 可点击区域（贴合物件的旋转框）
// 网址加 ?debug=1 可以看到点击区域和图层的框。
type Box = { left: number; top: number; width: number; height: number };
type Layer = Box & { id: string; src: string; clickable: boolean };
type Hotspot = Box & { id: string; rotate?: number; round?: boolean };

const SCENE = desk.image;
const ASPECT = SCENE.w / SCENE.h;
const CORE = desk.core; // 永远完整显示的区域（百分比）
// 场景宽度：让 core 刚好放进窗口
const SCENE_VARS = {
  "--ar": ASPECT,
  "--cx": (CORE.left + CORE.width / 2) / 100,
  "--cy": (CORE.top + CORE.height / 2) / 100,
  "--scene-w": `min(calc(100vw / ${CORE.width / 100}), calc(100vh * ${ASPECT} / ${CORE.height / 100}))`,
  "--dock-off": desk.dock.offset,
} as CSSProperties;
const LAYERS: Layer[] = desk.layers;
const HOTSPOTS: Hotspot[] = desk.hotspots;

// 物件 → 栏目
const TARGETS: Record<string, { section: SectionId; label: string }> = {
  laptop: { section: "projects", label: "./projects" },
  badge: { section: "experience", label: "./experience" },
  notebook: { section: "skills", label: "./skills" },
  print: { section: "about", label: "./about" },
  phone: { section: "contact", label: "./contact" },
  paper: { section: "resume", label: "./resume" },
  palette: { section: "experiments", label: "./experiments" },
};

// 底部导航的顺序；阅读模式再接上 now 和 how-this-desk-was-made
const DOCK_ORDER: SectionId[] = [
  "projects", "experience", "skills", "about", "demo", "experiments", "resume", "contact",
];
const READING_ORDER: SectionId[] = [...DOCK_ORDER, "now", "making"];

const byId = (ids: SectionId[]) =>
  ids
    .map((id) => SECTIONS.find((s) => s.id === id))
    .filter((s): s is Section => !!s && !s.hidden);

const pos = (b: Box): CSSProperties => ({
  left: `${b.left}%`,
  top: `${b.top}%`,
  width: `${b.width}%`,
  height: `${b.height}%`,
});

// 悬停：物件从底边「长高」一点（看起来离开桌面），投影变大变淡。
// 以底边为基准缩放，物件下方被挡住的那块桌面不会露出来。
// 投影只在悬停时加（静止时 filter 为 none，不额外占合成层）
const NO_SHADOW = "drop-shadow(0px 0px 0px rgba(60, 45, 30, 0))";
const SHADOW = "drop-shadow(7px 12px 14px rgba(60, 45, 30, 0.2))";
const REST = { scale: 1, filter: NO_SHADOW, transitionEnd: { filter: "none" } };
const LIFT = { scale: 1.03, filter: [NO_SHADOW, SHADOW] };
const SPRING: Transition = { type: "spring", stiffness: 320, damping: 26 };

// 图层图片的 sizes：和场景一起缩放（放大飞出的那份用同一个，直接命中缓存）
const layerSizes = (l: Box) =>
  `calc(${l.width / 100} * min(${Math.round(10000 / CORE.width)}vw, ${Math.round((ASPECT * 10000) / CORE.height)}vh))`;

function DeskLayer({ layer, active, wiggle, away, onWiggleEnd }: {
  layer: Layer;
  active: boolean;
  wiggle: boolean;
  away: boolean; // 正在放大飞出：原位这份先藏起来
  onWiggleEnd: () => void;
}) {
  const reduce = useReducedMotion();
  const animate = reduce
    ? { scale: 1, filter: "none" }
    : wiggle
      ? { rotate: [0, -2.5, 2, -1.2, 0], scale: [1, 1.06, 1.06, 1.06, 1] }
      : active
        ? LIFT
        : { ...REST, rotate: 0 };
  return (
    <motion.div
      className="layer"
      style={{
        ...pos(layer),
        zIndex: active ? 3 : 1,
        transformOrigin: "50% 100%",
        filter: "none",
        visibility: away ? "hidden" : undefined,
      }}
      initial={false}
      animate={animate}
      transition={wiggle ? { duration: 0.55, ease: "easeInOut" } : SPRING}
      onAnimationComplete={() => wiggle && onWiggleEnd()}
    >
      <Image
        src={layer.src}
        alt=""
        fill
        sizes={layerSizes(layer)}
        priority
      />
    </motion.div>
  );
}


// ====== 点开物件：镜头推进 → 虚化 → 面板弹出 ======
// 打开（约 0.9 秒，三步有重叠）：
//   0–450ms   被点的物件保持原大小，移到画面中心并摆正
//   300–700ms 整个场景（包括放大的物件）虚化，叠 20% 深色
//   500–900ms 面板从下方 40px 升到正中央并淡入
// 关闭（约 0.6 秒）倒放：面板下移淡出 → 虚化消失 → 物件飞回原位。
// 虚化用预先模糊好的小图淡入替换（desk3d/blur.mjs），只动 opacity，不用实时 CSS blur。
// 减弱动态：不推进，只做虚化和面板的淡入淡出。
const SECTION_OBJECT = Object.fromEntries(
  Object.entries(TARGETS).map(([obj, t]) => [t.section, obj]),
) as Partial<Record<SectionId, string>>;
// 网址里的 #：和栏目标题一致（#resume、#photo-to-short …）
const hashOf = (id: SectionId) => SECTIONS.find((s) => s.id === id)?.title.replace(".pdf", "") ?? id;
const sectionOfHash = (hash: string) =>
  DOCK_ORDER.find((id) => hashOf(id) === decodeURIComponent(hash.replace(/^#/, "")));

const ZOOM_H = 0.8; // 推进后物件占窗口高度（desk3d/blur.mjs、scene.py --hd 按这个数准备图）
const ZOOM_W = 0.9;
const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const T = {
  zoom: { duration: 0.45, ease: EASE_OUT },
  blurIn: { delay: 0.3, duration: 0.4, ease: "easeOut" },
  panelIn: { delay: 0.5, type: "spring", visualDuration: 0.4, bounce: 0.08 },
  panelOut: { duration: 0.2, ease: "easeIn" },
  blurOut: { delay: 0.1, duration: 0.25, ease: "easeIn" },
  zoomOut: { delay: 0.25, duration: 0.35, ease: [0.4, 0, 0.2, 1] },
  // 减弱动态
  fadeIn: { duration: 0.3 },
  fadeOut: { duration: 0.2 },
} satisfies Record<string, Transition>;
const OPEN_MS = 900;
// 只在事件里调用（判断动画是否还在进行）
function clock() {
  return performance.now();
}
const CLOSE_MS = 600;

type Pose = { x: number; y: number; scale: number; rotate: number };
type Flight = { layer: Layer; rect: Box; to: Pose };
// 推进的终点：移到画面中心、摆正，放大到物件占窗口高度约 80%
const HOME: Pose = { x: 0, y: 0, scale: 1, rotate: 0 };

function planFlight(scene: DOMRect, layerId: string): Flight | null {
  const layer = LAYERS.find((l) => l.id === layerId);
  const hotspot = HOTSPOTS.find((h) => h.id === layerId);
  if (!layer || !hotspot) return null;
  const rect = {
    left: scene.left + (layer.left / 100) * scene.width,
    top: scene.top + (layer.top / 100) * scene.height,
    width: (layer.width / 100) * scene.width,
    height: (layer.height / 100) * scene.height,
  };
  // 摆正后的物件大小 = 点击框（未旋转的物件外框）
  const ow = (hotspot.width / 100) * scene.width;
  const oh = (hotspot.height / 100) * scene.height;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const to = {
    x: vw / 2 - (rect.left + rect.width / 2),
    y: vh / 2 - (rect.top + rect.height / 2),
    scale: Math.min((ZOOM_H * vh) / oh, (ZOOM_W * vw) / ow),
    rotate: -(hotspot.rotate ?? 0),
  };
  return { layer, rect, to };
}

// 推进的物件：普通版本（已缓存）打底，高清版本盖在上面（同一裁切框，像素对齐）。
// 高清图预加载好了就从第一帧开始显示；还没好就先用普通版本，加载完再换上。
// 虚化时淡入替换成模糊图。飞回原位后这个元素移除，桌上的普通版本重新显示。
function Hero({ flight }: { flight: Flight }) {
  const { layer, rect } = flight;
  const [hd, setHd] = useState(() => hdReady(layer.id));
  const [late] = useState(() => !hdReady(layer.id));
  useEffect(() => {
    let live = true;
    loadHd(layer.id, true).then((ok) => live && ok && setHd(true));
    return () => {
      live = false;
    };
  }, [layer.id]);
  const b = (blur.layers as Record<string, { src: string; padX: number; padY: number }>)[layer.id];
  return (
    <motion.div
      className="hero"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      initial={HOME}
      animate={{ ...flight.to, transition: T.zoom }}
      exit={{ ...HOME, transition: T.zoomOut }}
    >
      <motion.div
        className="hero-sharp"
        // 模糊图先盖上来，清晰图再在下面撤掉（同时半透明会让物件看起来透明）
        initial={{ opacity: 1 }}
        animate={{ opacity: 0, transition: { delay: 0.58, duration: 0.12 } }}
        exit={{ opacity: 1, transition: { duration: 0.08 } }}
      >
        <Image src={layer.src} alt="" fill sizes={layerSizes(layer)} />
        {/* 加载成功后才放进页面（失败时不出现破图） */}
        {hd && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
          className="hero-hd"
          src={hdSrc(layer.id)}
          alt=""
          decoding="async"
          style={late ? { animation: "hd-in 0.15s ease-out" } : undefined}
        />
        )}
      </motion.div>
      {b && (
        <motion.img
          className="hero-blur"
          src={b.src}
          alt=""
          style={{
            left: `${-b.padX * 100}%`,
            top: `${-b.padY * 100}%`,
            width: `${(1 + 2 * b.padX) * 100}%`,
            height: `${(1 + 2 * b.padY) * 100}%`,
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { delay: 0.3, duration: 0.28, ease: "easeOut" } }}
          exit={{ opacity: 0, transition: T.blurOut }}
        />
      )}
    </motion.div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), iframe, input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function Home() {
  const [open, setOpen] = useState<SectionId | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [blurKey, setBlurKey] = useState("all"); // 用哪张模糊背景（推进的物件不在里面）
  const [hover, setHover] = useState<string | null>(null);
  const [wiggle, setWiggle] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [debug, setDebug] = useState(false);
  const [ui, setUi] = useState("");
  const reduce = useReducedMotion();
  const sceneRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const busyUntil = useRef(0); // 动画进行中忽略重复点击
  const openRef = useRef<SectionId | null>(null);
  const resume = useResume(open === "resume");

  const busy = () => clock() < busyUntil.current;
  const hold = (ms: number) => {
    busyUntil.current = clock() + ms;
  };

  // 找到某个栏目对应的入口（物件的点击区域，没有就用底部导航按钮），关闭后焦点回到这里
  const entryFor = (id: SectionId): HTMLElement | null => {
    const obj = SECTION_OBJECT[id];
    return (
      (obj && document.querySelector<HTMLElement>(`.hot[data-obj="${obj}"]`)) ||
      document.querySelector<HTMLElement>(`.dock button[data-sec="${id}"]`)
    );
  };

  const show = (id: SectionId, from: HTMLElement | null) => {
    returnTo.current = from;
    setHover(null); // 面板打开时暂停悬停效果
    const obj = SECTION_OBJECT[id];
    const scene = sceneRef.current?.getBoundingClientRect();
    const narrow = window.matchMedia("(max-width: 760px)").matches;
    const f = obj && scene && !narrow && !reduce ? planFlight(scene, obj) : null;
    setFlight(f);
    setBlurKey(f ? f.layer.id : "all");
    openRef.current = id;
    setOpen(id);
    hold(reduce ? 300 : OPEN_MS);
  };
  const hide = () => {
    if (!openRef.current) return;
    openRef.current = null;
    setOpen(null);
    hold(reduce ? 200 : CLOSE_MS);
  };

  // 点物件 / 导航：打开，网址加上 #栏目
  const openSection = (id: SectionId, from: HTMLElement) => {
    if (busy() || openRef.current) return;
    window.history.pushState({ panel: id }, "", `#${hashOf(id)}`);
    show(id, from);
  };
  // 点空白处 / Esc / 关闭按钮：自己加的 # 用"返回"退掉（交给 popstate 关），直接带 # 进来的就把 # 去掉
  const requestClose = () => {
    if (busy() || !openRef.current) return;
    if (window.history.state?.panel) window.history.back();
    else {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      hide();
    }
  };

  // 手机屏幕默认用阅读模式；网址带 ?debug=1 时显示点击区域；带 #栏目 时自动打开
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const narrow = window.matchMedia("(max-width: 760px)").matches;
      if (narrow) setReading(true);
      if (new URLSearchParams(window.location.search).get("debug") === "1") setDebug(true);
      const sec = sectionOfHash(window.location.hash);
      if (!sec) return;
      if (narrow) {
        setTimeout(() => document.getElementById(`sec-${hashOf(sec)}`)?.scrollIntoView(), 50);
      } else {
        setTimeout(() => show(sec, entryFor(sec)), 350);
      }
    });
    return () => cancelAnimationFrame(id);
    // 只在加载时跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 浏览器返回 / 前进：按网址里的 # 关闭或打开面板（动画中就等它播完）。
  // 监听器只挂一次：Next 的路由在 popstate 里会同步重渲染，每次重挂的监听器会错过这次事件
  const onPop = useEffectEvent(() => {
    const sec = sectionOfHash(window.location.hash);
    if (!sec) hide();
    else if (!openRef.current) show(sec, entryFor(sec));
  });
  useEffect(() => {
    const handler = () => {
      const wait = busyUntil.current - clock();
      if (wait > 0) setTimeout(onPop, wait + 20);
      else onPop();
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  // 高清物件：首屏加载完、浏览器空闲时预加载（手机阅读模式不加载）
  useEffect(() => {
    if (reading) return;
    return preloadHd(LAYERS.filter((l) => l.clickable).map((l) => l.id));
  }, [reading]);

  // 预先加载模糊图（很小，一共约 190 KB），点开时马上能用
  useEffect(() => {
    const t = setTimeout(() => {
      [...Object.values(blur.bg), ...Object.values(blur.layers).map((l) => l.src)].forEach((src) => {
        const img = new window.Image();
        img.src = src;
      });
    }, 1500);
    return () => clearTimeout(t);
  }, []);

  // ?debug=1：量出标题、按钮、导航的实际尺寸（desk3d/scene.py 布局检查里的 TITLE / MODE_BTN / DOCK）
  useEffect(() => {
    if (!debug) return;
    const measure = () => {
      const r = (sel: string) => {
        const b = document.querySelector(sel)?.getBoundingClientRect();
        return b ? `${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}×${Math.round(b.height)}` : "-";
      };
      setUi(`window ${innerWidth}×${innerHeight} · title ${r(".name")} · mode ${r(".mode")} · dock ${r(".dock")}`);
    };
    const id = requestAnimationFrame(measure);
    addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(id);
      removeEventListener("resize", measure);
    };
  }, [debug]);

  // Esc 关闭
  const onEsc = useEffectEvent(() => requestClose());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEsc();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 面板打开：焦点移到面板里的关闭按钮
  useEffect(() => {
    if (open) closeRef.current?.focus({ preventScroll: true });
  }, [open]);

  // Tab 只在面板里循环
  const trapTab = (e: ReactKeyboardEvent) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.getClientRects().length > 0,
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const inside = panelRef.current.contains(document.activeElement);
    if (e.shiftKey && (document.activeElement === first || !inside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
      e.preventDefault();
      first.focus();
    }
  };

  const current = SECTIONS.find((s) => s.id === open);
  const reader = byId(READING_ORDER).filter((s) => s.id !== "making" || HAS_GENERATED_DESK);
  const dock = byId(DOCK_ORDER);
  const hoverOn = (id: string) => (on: boolean) =>
    setHover((h) => (on ? id : h === id ? null : h));
  const isOpen = !!current && !reading;
  const wide = open === "skills" || open === "resume";
  // 标题、reading mode 按钮、导航：面板打开时淡出，关闭后淡回
  const chrome = {
    animate: { opacity: isOpen ? 0 : 1 },
    transition: { duration: 0.25, delay: isOpen ? 0 : 0.35 },
  };

  return (
    <main className={`page${reading ? "" : " on-desk"}`} style={SCENE_VARS}>
      <motion.header className="top" inert={isOpen} initial={false} {...chrome}>
        <h1 className="name">
          Hello!
          <br />
          I&apos;m Jingwen Wang.
        </h1>
        <button className="mode" onClick={() => setReading((r) => !r)}>
          {reading ? "desk mode" : "reading mode"}
        </button>
      </motion.header>

      {reading ? (
        <div className="reading">
          {reader.map((s) => (
            <section key={s.id} id={`sec-${hashOf(s.id)}`} className="read-sec">
              <h2>{s.title}</h2>
              {s.body}
            </section>
          ))}
        </div>
      ) : (
        <>
          <div className="stage" inert={isOpen}>
            <div className="scene" ref={sceneRef}>
              <Image
                className="scene-img"
                src={SCENE.src}
                alt=""
                fill
                priority
                sizes={`min(${Math.round(10000 / CORE.width)}vw, ${Math.round((ASPECT * 10000) / CORE.height)}vh)`}
              />

              {LAYERS.map((layer) => (
                <DeskLayer
                  key={layer.id}
                  layer={layer}
                  active={hover === layer.id}
                  wiggle={wiggle === layer.id}
                  away={flight?.layer.id === layer.id}
                  onWiggleEnd={() => setWiggle(null)}
                />
              ))}

              {/* 不可点的装饰（耳机盒）：悬停时轻轻晃一下 */}
              {LAYERS.filter((l) => !l.clickable).map((l) => (
                <div
                  key={`deco-${l.id}`}
                  className={`deco${debug ? " debug" : ""}`}
                  style={pos(l)}
                  onMouseEnter={() => !reduce && !isOpen && setWiggle(l.id)}
                  aria-hidden="true"
                />
              ))}

              {/* 可点击区域：贴合物件的旋转框 */}
              {HOTSPOTS.filter((h) => h.id in TARGETS).map((h) => {
                const t = TARGETS[h.id];
                const r = h.rotate ?? 0;
                return (
                  <button
                    key={h.id}
                    data-obj={h.id}
                    className={`hot${h.round ? " round" : ""}${debug ? " debug" : ""}`}
                    style={{ ...pos(h), "--r": `${r}deg` } as CSSProperties}
                    onClick={(e) => openSection(t.section, e.currentTarget)}
                    onMouseEnter={() => {
                      hoverOn(h.id)(true);
                      loadHd(h.id, true); // 悬停的物件优先加载高清图
                    }}
                    onMouseLeave={() => hoverOn(h.id)(false)}
                    // 键盘聚焦时也抬起；关闭面板后焦点回来时（鼠标操作）不抬
                    onFocus={(e) => e.currentTarget.matches(":focus-visible") && hoverOn(h.id)(true)}
                    onBlur={() => hoverOn(h.id)(false)}
                    aria-label={`Open ${t.label.replace("./", "")}`}
                    aria-haspopup="dialog"
                  >
                    {debug && <span className="hot-id">{h.id}</span>}
                  </button>
                );
              })}

              {/* 物件上方的小标签 */}
              <AnimatePresence>
                {LAYERS.filter((l) => l.id === hover && TARGETS[l.id] && !isOpen).map((l) => (
                  <motion.span
                    key={`tip-${l.id}`}
                    className="tip"
                    style={{ left: `${l.left + l.width / 2}%`, top: `${l.top}%` }}
                    initial={reduce ? { opacity: 1 } : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: 4 }}
                    transition={{ duration: reduce ? 0 : 0.18, ease: "easeOut" }}
                  >
                    {TARGETS[l.id].label}
                  </motion.span>
                ))}
              </AnimatePresence>

              {/* 虚化：预先模糊好的整张桌面（不含推进的那个物件），淡入盖住清晰的场景 */}
              <AnimatePresence>
                {isOpen && (
                  <motion.img
                    key="scene-blur"
                    className="scene-blur"
                    src={(blur.bg as Record<string, string>)[blurKey] ?? blur.bg.all}
                    alt=""
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1, transition: reduce ? T.fadeIn : T.blurIn }}
                    exit={{ opacity: 0, transition: reduce ? T.fadeOut : T.blurOut }}
                  />
                )}
              </AnimatePresence>
            </div>
          </div>

          {debug && <p className="ui-debug">{ui}</p>}

          <motion.nav className="dock" aria-label="Sections" inert={isOpen} initial={false} {...chrome}>
            {dock.map((s) => (
              <button
                key={s.id}
                data-sec={s.id}
                onClick={(e) => openSection(s.id, e.currentTarget)}
                aria-haspopup="dialog"
              >
                {s.title.replace(".pdf", "")}
              </button>
            ))}
          </motion.nav>
        </>
      )}

      {/* 推进的物件；飞回原位后原位那份才重新显示 */}
      <AnimatePresence onExitComplete={() => setFlight(null)}>
        {isOpen && flight && <Hero key={flight.layer.id} flight={flight} />}
      </AnimatePresence>

      {/* 20% 深色；点空白处关闭 */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="dim"
            className="dim"
            onClick={requestClose}
            onMouseDown={(e) => e.preventDefault()} // 动画中被忽略的点击也不要把焦点从面板里拿走
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: reduce ? T.fadeIn : T.blurIn }}
            exit={{ opacity: 0, transition: reduce ? T.fadeOut : T.blurOut }}
          />
        )}
      </AnimatePresence>

      {/* 居中的面板 */}
      <div className="panel-wrap">
        <AnimatePresence onExitComplete={() => returnTo.current?.focus({ preventScroll: true })}>
          {isOpen && current && (
            <motion.section
              key={current.id}
              ref={panelRef}
              className={`panel p-${current.id}${wide ? " wide" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="panel-title"
              onKeyDown={trapTab}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 40 }}
              animate={
                reduce
                  ? { opacity: 1, transition: { ...T.fadeIn, delay: 0.1 } }
                  : { opacity: 1, y: 0, transition: { ...T.panelIn, opacity: { delay: 0.5, duration: 0.3 } } }
              }
              exit={reduce ? { opacity: 0, transition: T.fadeOut } : { opacity: 0, y: 40, transition: T.panelOut }}
            >
              <header className="panel-head">
                <h2 id="panel-title" className="panel-path">
                  ./{hashOf(current.id)}
                </h2>
                <button
                  ref={closeRef}
                  className="panel-x"
                  onClick={requestClose}
                  aria-label={`Close ${hashOf(current.id)}`}
                >
                  close · esc
                </button>
              </header>
              <div className="panel-body">
                <PanelBody section={current} resume={resume} />
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
