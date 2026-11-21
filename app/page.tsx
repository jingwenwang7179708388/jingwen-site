"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "motion/react";
import { SECTIONS, type Section, type SectionId } from "./content";
import { HAS_GENERATED_DESK } from "./assets";
import { PanelBody, PaperSheet } from "./panels";
import { useResume } from "./resume";
import desk from "./desk-hotspots.json";

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


// ====== 点开物件：物件放大飞到左侧并摆正，背景虚化，右侧滑出面板 ======
// 时间线（毫秒）：0–400 物件飞出 + 背景虚化变暗；250 起面板从右侧滑入。关闭时倒放。
// 减弱动态：物件直接出现在终点、面板不滑动，都只做淡入淡出。
const SECTION_OBJECT = Object.fromEntries(
  Object.entries(TARGETS).map(([obj, t]) => [t.section, obj]),
) as Partial<Record<SectionId, string>>;
const EASE = [0.22, 1, 0.36, 1] as const;
const FLY_S = 0.4;
const PANEL_DELAY = 0.25;

type Pose = { x: number; y: number; scale: number; rotate: number };
type Flight = {
  layer: Layer;
  hotspot: Hotspot;
  rect: Box; // 物件图层在屏幕上的原位置（px）
  to: Pose | { [K in keyof Pose]: number[] }; // 终点；skills 是关键帧（先放大，再缩到左上角）
  end: Pose; // 最终停下的样子（减弱动态时直接用这个）
  scale: number; // 最大放大倍数（决定高清图的尺寸）
};

const HOME: Pose = { x: 0, y: 0, scale: 1, rotate: 0 };

function planFlight(scene: DOMRect, layerId: string, section: SectionId): Flight | null {
  const layer = LAYERS.find((l) => l.id === layerId);
  const hotspot = HOTSPOTS.find((h) => h.id === layerId);
  if (!layer || !hotspot) return null;
  const rect = {
    left: scene.left + (layer.left / 100) * scene.width,
    top: scene.top + (layer.top / 100) * scene.height,
    width: (layer.width / 100) * scene.width,
    height: (layer.height / 100) * scene.height,
  };
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  // 摆正后的物件大小 = 点击框（未旋转的物件外框）
  const ow = (hotspot.width / 100) * scene.width;
  const oh = (hotspot.height / 100) * scene.height;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fit = (bw: number, bh: number, max: number) => Math.min(max, bw / ow, bh / oh);
  const rotate = -(hotspot.rotate ?? 0);

  if (section === "skills") {
    // 笔记本：先在左侧放大，再缩到左上角，给更宽的卡片面板让位
    const big = fit(vw * 0.4, vh * 0.72, 1.8);
    const small = fit(Math.max(vw * 0.22 - 56, 110), vh * 0.32, 1);
    const end = {
      x: 28 + (ow * small) / 2 - cx,
      y: 28 + (oh * small) / 2 - cy,
      scale: small,
      rotate,
    };
    return {
      layer, hotspot, rect, end, scale: big,
      to: {
        x: [0, vw * 0.24 - cx, end.x],
        y: [0, vh * 0.5 - cy, end.y],
        scale: [1, big, small],
        rotate: [0, rotate, rotate],
      },
    };
  }
  // 其他物件：移到左侧约三分之一处，放大 2 倍以内（放不下就按左侧空间缩小）
  const s = fit(vw * 0.45 - 72, vh * 0.76, 2);
  const end = { x: vw * 0.225 - cx, y: vh * 0.5 - cy, scale: s, rotate };
  return { layer, hotspot, rect, end, to: end, scale: s };
}

// 飞出的物件：先用和原位相同尺寸的图（已缓存，马上显示），高清图加载完再盖上去
function Hero({ flight, resume }: { flight: Flight; resume: ReturnType<typeof useResume> }) {
  const reduce = useReducedMotion();
  const [hi, setHi] = useState(false);
  const { layer, hotspot: h, rect } = flight;
  const keyframes = Array.isArray((flight.to as { x: unknown }).x);
  return (
    <motion.div
      className="hero"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      initial={reduce ? { ...flight.end, opacity: 0 } : { ...HOME, opacity: 1 }}
      animate={reduce ? { ...flight.end, opacity: 1 } : { ...flight.to, opacity: 1 }}
      exit={
        reduce
          ? { opacity: 0, transition: { duration: 0.2 } }
          : { ...HOME, transition: { delay: 0.15, duration: FLY_S, ease: EASE } }
      }
      transition={
        reduce
          ? { duration: 0.2 }
          : keyframes
            ? { duration: 0.85, ease: EASE, times: [0, 0.45, 1] }
            : { duration: FLY_S, ease: EASE }
      }
    >
      <Image src={layer.src} alt="" fill sizes={layerSizes(layer)} />
      <Image
        src={layer.src}
        alt=""
        fill
        sizes={`${Math.round(rect.width * flight.scale)}px`}
        className="hero-hi"
        style={{ opacity: hi ? 1 : 0 }}
        onLoad={() => setHi(true)}
      />
      {layer.id === "paper" && (
        <PaperSheet
          resume={resume}
          style={{
            left: `${((h.left + h.width / 2 - layer.left) / layer.width) * 100}%`,
            top: `${((h.top + h.height / 2 - layer.top) / layer.height) * 100}%`,
            width: `${(h.width / layer.width) * 100 * 0.9}%`,
            height: `${(h.height / layer.height) * 100 * 0.92}%`,
            rotate: `${h.rotate ?? 0}deg`,
          }}
        />
      )}
    </motion.div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), iframe, input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function Home() {
  const [open, setOpen] = useState<SectionId | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
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
  const resume = useResume(open === "resume");

  // 手机屏幕默认用阅读模式；网址带 ?debug=1 时显示点击区域
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 760px)").matches) setReading(true);
      if (new URLSearchParams(window.location.search).get("debug") === "1") setDebug(true);
    });
    return () => cancelAnimationFrame(id);
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

  // 按 Esc 关闭面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 面板打开：焦点移到面板里的关闭按钮
  useEffect(() => {
    if (open) closeRef.current?.focus({ preventScroll: true });
  }, [open]);

  const openSection = (id: SectionId, from: HTMLElement) => {
    returnTo.current = from;
    setHover(null); // 面板打开时暂停悬停效果
    const obj = SECTION_OBJECT[id];
    const scene = sceneRef.current?.getBoundingClientRect();
    const narrow = window.matchMedia("(max-width: 760px)").matches;
    setFlight(obj && scene && !narrow ? planFlight(scene, obj, id) : null);
    setOpen(id);
  };
  const close = () => setOpen(null);

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
  // 标题、导航：面板打开时淡出，关闭后淡回
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
            <section key={s.id} className="read-sec">
              <h2>{s.title}</h2>
              {s.body}
            </section>
          ))}
        </div>
      ) : (
        <>
          <motion.div
            className="stage"
            inert={isOpen}
            initial={false}
            animate={
              isOpen
                ? { filter: reduce ? "blur(0px)" : "blur(12px)", transition: { duration: FLY_S, ease: "easeOut" } }
                : { filter: "blur(0px)", transitionEnd: { filter: "none" }, transition: { delay: 0.15, duration: FLY_S } }
            }
          >
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
                    className={`hot${h.round ? " round" : ""}${debug ? " debug" : ""}`}
                    style={{ ...pos(h), "--r": `${r}deg` } as CSSProperties}
                    onClick={(e) => openSection(t.section, e.currentTarget)}
                    onMouseEnter={() => hoverOn(h.id)(true)}
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
            </div>
          </motion.div>

          {debug && <p className="ui-debug">{ui}</p>}

          <motion.nav className="dock" aria-label="Sections" inert={isOpen} initial={false} {...chrome}>
            {dock.map((s) => (
              <button key={s.id} onClick={(e) => openSection(s.id, e.currentTarget)} aria-haspopup="dialog">
                {s.title.replace(".pdf", "")}
              </button>
            ))}
          </motion.nav>
        </>
      )}

      {/* 背景虚化 + 变暗；点空白处关闭 */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="dim"
            className="dim"
            onClick={close}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: reduce ? 0.2 : FLY_S, ease: "easeOut" } }}
            exit={{ opacity: 0, transition: { delay: reduce ? 0 : 0.15, duration: reduce ? 0.2 : FLY_S } }}
          />
        )}
      </AnimatePresence>

      {/* 放大的物件；飞回原位后才让原位那份重新显示 */}
      <AnimatePresence onExitComplete={() => setFlight(null)}>
        {isOpen && flight && <Hero key={flight.layer.id} flight={flight} resume={resume} />}
      </AnimatePresence>

      {/* 右侧面板 */}
      <AnimatePresence onExitComplete={() => returnTo.current?.focus({ preventScroll: true })}>
        {isOpen && current && (
          <motion.section
            key={current.id}
            ref={panelRef}
            className={`panel p-${current.id}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="panel-title"
            onKeyDown={trapTab}
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: 64 }}
            animate={{
              opacity: 1,
              x: 0,
              transition: reduce ? { duration: 0.2 } : { delay: PANEL_DELAY, duration: 0.38, ease: EASE },
            }}
            exit={
              reduce
                ? { opacity: 0, transition: { duration: 0.15 } }
                : { opacity: 0, x: 64, transition: { duration: 0.22, ease: "easeIn" } }
            }
          >
            <header className="panel-head">
              <h2 id="panel-title" className="panel-title">
                {current.title}
              </h2>
              <button ref={closeRef} className="panel-x" onClick={close} aria-label={`Close ${current.title}`}>
                ×
              </button>
            </header>
            <div className="panel-body">
              <PanelBody section={current} resume={resume} />
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </main>
  );
}
