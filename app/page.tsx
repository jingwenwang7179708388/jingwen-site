"use client";

import Image from "next/image";
import { useEffect, useState, type CSSProperties, type MouseEvent } from "react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "motion/react";
import { SECTIONS, type Section, type SectionId } from "./content";
import { HAS_GENERATED_DESK } from "./assets";
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

function DeskLayer({ layer, active, wiggle, onWiggleEnd }: {
  layer: Layer;
  active: boolean;
  wiggle: boolean;
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
      style={{ ...pos(layer), zIndex: active ? 3 : 1, transformOrigin: "50% 100%", filter: "none" }}
      initial={false}
      animate={animate}
      transition={wiggle ? { duration: 0.55, ease: "easeInOut" } : SPRING}
      onAnimationComplete={() => wiggle && onWiggleEnd()}
    >
      <Image
        src={layer.src}
        alt=""
        fill
        sizes={`calc(${layer.width / 100} * min(${Math.round(10000 / CORE.width)}vw, ${Math.round((ASPECT * 10000) / CORE.height)}vh))`}
        priority
      />
    </motion.div>
  );
}

type Origin = { x: number; y: number };

export default function Home() {
  const [open, setOpen] = useState<SectionId | null>(null);
  const [origin, setOrigin] = useState<Origin>({ x: 0, y: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const [wiggle, setWiggle] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [debug, setDebug] = useState(false);
  const [ui, setUi] = useState("");
  const reduce = useReducedMotion();

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

  // 按 Esc 关闭窗口
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 打开窗口：记下被点的东西在屏幕上的位置，窗口从那里放大出来
  const openFrom = (id: SectionId) => (e: MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setOrigin({
      x: r.left + r.width / 2 - window.innerWidth / 2,
      y: r.top + r.height / 2 - window.innerHeight / 2,
    });
    setOpen(id);
  };

  const current = SECTIONS.find((s) => s.id === open);
  const reader = byId(READING_ORDER).filter((s) => s.id !== "making" || HAS_GENERATED_DESK);
  const dock = byId(DOCK_ORDER);
  const hoverOn = (id: string) => (on: boolean) =>
    setHover((h) => (on ? id : h === id ? null : h));

  const hidden = reduce
    ? { opacity: 0 }
    : { opacity: 0, scale: 0.12, x: origin.x, y: origin.y };

  return (
    <main className={`page${reading ? "" : " on-desk"}`} style={SCENE_VARS}>
      <header className="top">
        <h1 className="name">Hello! I&apos;m Jingwen Wang.</h1>
        <button className="mode" onClick={() => setReading((r) => !r)}>
          {reading ? "desk mode" : "reading mode"}
        </button>
      </header>

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
          <div className="stage">
            <div className="scene">
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
                  onWiggleEnd={() => setWiggle(null)}
                />
              ))}

              {/* 不可点的装饰（耳机盒）：悬停时轻轻晃一下 */}
              {LAYERS.filter((l) => !l.clickable).map((l) => (
                <div
                  key={`deco-${l.id}`}
                  className={`deco${debug ? " debug" : ""}`}
                  style={pos(l)}
                  onMouseEnter={() => !reduce && setWiggle(l.id)}
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
                    onClick={openFrom(t.section)}
                    onMouseEnter={() => hoverOn(h.id)(true)}
                    onMouseLeave={() => hoverOn(h.id)(false)}
                    onFocus={() => hoverOn(h.id)(true)}
                    onBlur={() => hoverOn(h.id)(false)}
                    aria-label={`Open ${t.label.replace("./", "")}`}
                  >
                    {debug && <span className="hot-id">{h.id}</span>}
                  </button>
                );
              })}

              {/* 物件上方的小标签 */}
              <AnimatePresence>
                {LAYERS.filter((l) => l.id === hover && TARGETS[l.id]).map((l) => (
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
          </div>

          {debug && <p className="ui-debug">{ui}</p>}

          <nav className="dock" aria-label="Sections">
            {dock.map((s) => (
              <button
                key={s.id}
                className={open === s.id ? "on" : ""}
                onClick={openFrom(s.id)}
              >
                {s.title.replace(".pdf", "")}
              </button>
            ))}
          </nav>
        </>
      )}

      <AnimatePresence>
        {current && !reading && (
          <motion.div
            key="overlay"
            className="overlay"
            onClick={() => setOpen(null)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: "none" }}
            transition={{ duration: 0.2 }}
          >
            <motion.div
              key={current.id}
              className={`win${current.wide ? " wide" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-label={current.title}
              onClick={(e) => e.stopPropagation()}
              initial={hidden}
              animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
              exit={hidden}
              transition={{ type: "spring", stiffness: 380, damping: 34, mass: 0.9 }}
            >
              <div className="win-bar">
                <span className="dots">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="win-title">~/jingwen/{current.title}</span>
                <button className="x" onClick={() => setOpen(null)} aria-label="Close" autoFocus>
                  ×
                </button>
              </div>
              <div className="win-body">{current.body}</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
