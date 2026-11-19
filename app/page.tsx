"use client";

import Image from "next/image";
import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { SECTIONS, type SectionId } from "./content";
import { DESK_ASSETS, DESK_BACKGROUND, HAS_GENERATED_DESK } from "./assets";
import { DeskArt } from "./DeskObject";
import {
  Badge,
  Boba,
  Camera,
  Laptop,
  Notebook,
  Phone,
  Resume,
  StickyNotes,
  Storyboard,
} from "./DeskObjects";

// ====== 桌上物件的位置：left/top/width 都是占桌面的百分比，rotate 是旋转角度 ======
// id 用来在 assets.ts 里对应生成好的图片 / 视频
type DeskItem = {
  id: string;
  section: SectionId | null; // null = 纯装饰，点了没反应
  label: string;
  left: number;
  top: number;
  width: number;
  rotate: number;
  art: ReactNode;
};

const ITEMS: DeskItem[] = [
  { id: "notebook", section: "now", label: "./now", left: 17, top: 14, width: 11, rotate: -6, art: <Notebook /> },
  { id: "laptop", section: "projects", label: "./projects", left: 35, top: 20, width: 29, rotate: 0, art: <Laptop /> },
  { id: "camera", section: "photos", label: "./photos", left: 69, top: 15, width: 15, rotate: 8, art: <Camera /> },
  { id: "boba", section: null, label: "", left: 88, top: 6, width: 7, rotate: 0, art: <Boba /> },
  { id: "badge", section: "about", label: "./about", left: 6, top: 44, width: 10, rotate: -10, art: <Badge /> },
  { id: "notes", section: "experiments", label: "./experiments", left: 18, top: 62, width: 12, rotate: 4, art: <StickyNotes /> },
  { id: "storyboard", section: "demo", label: "./photo-to-short", left: 36, top: 64, width: 18, rotate: -3, art: <Storyboard /> },
  { id: "phone", section: "contact", label: "./contact", left: 59, top: 60, width: 7, rotate: -8, art: <Phone /> },
  { id: "resume", section: "resume", label: "./resume", left: 71, top: 54, width: 12, rotate: 6, art: <Resume /> },
];

type Origin = { x: number; y: number };

export default function Home() {
  const [open, setOpen] = useState<SectionId | null>(null);
  const [origin, setOrigin] = useState<Origin>({ x: 0, y: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const reduce = useReducedMotion();

  // 手机屏幕默认用阅读模式
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 760px)").matches) setReading(true);
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
  const visible = SECTIONS.filter((s) => s.id !== "making" || HAS_GENERATED_DESK);

  const hidden = reduce
    ? { opacity: 0 }
    : { opacity: 0, scale: 0.12, x: origin.x, y: origin.y };

  return (
    <main className="page">
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
          <div className={`desk${DESK_BACKGROUND ? " has-bg" : ""}`}>
            {DESK_BACKGROUND ? (
              <Image
                className="desk-bg"
                src={DESK_BACKGROUND.src}
                alt=""
                fill
                priority
                sizes="(max-width: 1240px) 100vw, 1200px"
              />
            ) : (
              <div className="mat" />
            )}
            {ITEMS.map((it) => {
              const style = {
                left: `${it.left}%`,
                top: `${it.top}%`,
                width: `${it.width}%`,
                "--r": `${it.rotate}deg`,
              } as CSSProperties;
              const art = (
                <DeskArt
                  asset={DESK_ASSETS[it.id]}
                  fallback={it.art}
                  widthPct={it.width}
                  hovered={hover === it.id}
                />
              );
              const hoverProps = {
                onMouseEnter: () => setHover(it.id),
                onMouseLeave: () => setHover((h) => (h === it.id ? null : h)),
              };
              return it.section ? (
                <button
                  key={it.id}
                  className="obj"
                  style={style}
                  onClick={openFrom(it.section)}
                  onFocus={() => setHover(it.id)}
                  onBlur={() => setHover((h) => (h === it.id ? null : h))}
                  aria-label={`Open ${it.label.replace("./", "")}`}
                  {...hoverProps}
                >
                  {art}
                  <span className="tip">{it.label}</span>
                </button>
              ) : (
                <div key={it.id} className="obj deco" style={style} {...hoverProps}>
                  {art}
                </div>
              );
            })}
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
            {SECTIONS.filter((s) => s.inDock !== false).map((s) => (
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
