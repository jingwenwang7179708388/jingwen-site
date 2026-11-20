"use client";

import Image from "next/image";
import { useEffect, useState, type CSSProperties, type MouseEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { SECTIONS, type SectionId } from "./content";
import { DESK_BACKGROUND, HAS_GENERATED_DESK } from "./assets";
import deskHotspots from "./desk-hotspots.json";

// ====== 场景图上的透明点击区域 ======
// 位置由 desk3d/scene.py 从 3D 场景算出来（app/desk-hotspots.json），不用手调：
// left / top / width / height 是占场景图宽高的百分比，是物件「没旋转时」的框，
// rotate 再按中心点转到物件的角度。改了场景重新渲染，json 会一起更新。
// 网址加 ?debug=1 可以看到每个框。拿铁和耳机是纯装饰，没有点击区域。
const TARGETS: Record<string, { section: SectionId; label: string }> = {
  laptop: { section: "projects", label: "./projects" },
  notebook: { section: "now", label: "./now" },
  badge: { section: "about", label: "./about" },
  print: { section: "demo", label: "./photo-to-short" },
  phone: { section: "contact", label: "./contact" },
  paper: { section: "resume", label: "./resume" },
  palette: { section: "experiments", label: "./experiments" },
};

type Hotspot = {
  id: string;
  section: SectionId;
  label: string;
  left: number;
  top: number;
  width: number;
  height: number;
  rotate?: number;
  round?: boolean;
};

const HOTSPOTS: Hotspot[] = deskHotspots.hotspots
  .filter((h) => h.id in TARGETS)
  .map((h) => ({ ...h, ...TARGETS[h.id] }));

type Origin = { x: number; y: number };

function HotspotButton({
  spot,
  active,
  debug,
  onHover,
  onOpen,
}: {
  spot: Hotspot;
  active: boolean;
  debug: boolean;
  onHover: (on: boolean) => void;
  onOpen: (e: MouseEvent<HTMLElement>) => void;
}) {
  const reduce = useReducedMotion();
  const r = spot.rotate ?? 0;
  const style = {
    left: `${spot.left}%`,
    top: `${spot.top}%`,
    width: `${spot.width}%`,
    height: `${spot.height}%`,
    "--r": `${r}deg`,
  } as CSSProperties;
  const center = {
    left: `${spot.left + spot.width / 2}%`,
    top: `${spot.top + spot.height / 2}%`,
  };

  return (
    <>
      <button
        className={`hot${spot.round ? " round" : ""}${debug ? " debug" : ""}`}
        style={style}
        onClick={onOpen}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        onFocus={() => onHover(true)}
        onBlur={() => onHover(false)}
        aria-label={`Open ${spot.label.replace("./", "")}`}
      >
        {/* 悬停：物件区域微微提亮。减弱动态模式下不提亮 */}
        <motion.span
          className="glow"
          initial={false}
          animate={{ opacity: active && !reduce ? 1 : 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        />
        {debug && (
          <span className="hot-id">
            {spot.id} · {spot.left},{spot.top} · {spot.width}×{spot.height}
            {r ? ` · ${r}°` : ""}
          </span>
        )}
      </button>
      <AnimatePresence>
        {active && (
          <motion.span
            key="tip"
            className="tip"
            style={center}
            initial={reduce ? { opacity: 1 } : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: 4 }}
            transition={{ duration: reduce ? 0 : 0.2, ease: "easeOut" }}
          >
            {spot.label}
          </motion.span>
        )}
      </AnimatePresence>
    </>
  );
}

export default function Home() {
  const [open, setOpen] = useState<SectionId | null>(null);
  const [origin, setOrigin] = useState<Origin>({ x: 0, y: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [debug, setDebug] = useState(false);
  const reduce = useReducedMotion();

  // 手机屏幕默认用阅读模式；网址带 ?debug=1 时显示点击区域
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 760px)").matches) setReading(true);
      if (new URLSearchParams(window.location.search).get("debug") === "1") setDebug(true);
    });
    return () => cancelAnimationFrame(id);
  }, []);

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
  const visible = SECTIONS.filter(
    (s) => !s.hidden && (s.id !== "making" || HAS_GENERATED_DESK),
  );

  const hidden = reduce
    ? { opacity: 0 }
    : { opacity: 0, scale: 0.12, x: origin.x, y: origin.y };

  return (
    <main className={`page${reading ? "" : " on-desk"}`}>
      <header className="top">
        <div>
          <h1 className="name">Jingwen Wang</h1>
          <p className="tagline">
            I turn new AI models into things people want to try.
          </p>
        </div>
        <button className="mode" onClick={() => setReading((r) => !r)}>
          {reading ? "desk mode" : "reading mode"}
        </button>
      </header>

      {reading ? (
        <div className="reading">
          {visible.map((s) => (
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
              {DESK_BACKGROUND && (
                <Image
                  className="scene-img"
                  src={DESK_BACKGROUND.src}
                  alt=""
                  fill
                  priority
                  sizes="max(100vw, 160vh)"
                />
              )}
              {HOTSPOTS.map((spot) => (
                <HotspotButton
                  key={spot.id}
                  spot={spot}
                  active={hover === spot.id}
                  debug={debug}
                  onHover={(on) =>
                    setHover((h) => (on ? spot.id : h === spot.id ? null : h))
                  }
                  onOpen={openFrom(spot.section)}
                />
              ))}
            </div>
          </div>
          <p className="hint">
            click anything on the desk
            {HAS_GENERATED_DESK && (
              <>
                {" · "}
                <button className="make-link" onClick={openFrom("making")}>
                  how this desk was made →
                </button>
              </>
            )}
          </p>

          <nav className="dock" aria-label="Sections">
            {SECTIONS.filter((s) => s.inDock !== false && !s.hidden).map((s) => (
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
