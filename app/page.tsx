"use client";

import Image from "next/image";
import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion, type Transition, type Variants } from "motion/react";
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

// ====== 物件的投影与动效 ======
// 光从左上方来 → 投影统一落在右下方。投影加在不旋转的外层上，
// 所以不管物件转了多少度，投影方向都一致。
const SHADOW = {
  rest: "drop-shadow(1.5px 2.5px 1.5px rgba(48, 26, 8, 0.32)) drop-shadow(6px 10px 12px rgba(48, 26, 8, 0.2))",
  lift: "drop-shadow(3px 5px 4px rgba(48, 26, 8, 0.24)) drop-shadow(14px 22px 22px rgba(48, 26, 8, 0.22))",
};

// 外层：透明度 + 投影
const OBJ_VARIANTS: Variants = {
  hidden: { opacity: 0, filter: SHADOW.lift },
  rest: { opacity: 1, filter: SHADOW.rest },
  lift: { opacity: 1, filter: SHADOW.lift },
};

// 内层：位移 + 缩放（旋转写在 style 里）
const ART_VARIANTS: Variants = {
  hidden: { y: -36, scale: 1.06 },
  rest: { y: 0, scale: 1 },
  lift: { y: -8, scale: 1.04 },
};

const HOVER_TRANSITION: Transition = { type: "spring", stiffness: 420, damping: 30 };
const dropTransition = (i: number): Transition => ({
  type: "spring",
  stiffness: 260,
  damping: 24,
  delay: 0.15 + i * 0.07,
  opacity: { duration: 0.35, delay: 0.15 + i * 0.07 },
});

function DeskObj({
  item,
  index,
  hovered,
  onHover,
  onOpen,
  children,
}: {
  item: DeskItem;
  index: number;
  hovered: boolean;
  onHover: (on: boolean) => void;
  onOpen?: (e: MouseEvent<HTMLElement>) => void;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const [landed, setLanded] = useState(false);

  // 减弱动态：不落下、不抬起，投影保持静止
  const transition: Transition = reduce
    ? { duration: 0 }
    : landed
      ? HOVER_TRANSITION
      : dropTransition(index);
  const state = hovered && item.section && !reduce ? "lift" : "rest";

  const style = {
    left: `${item.left}%`,
    top: `${item.top}%`,
    width: `${item.width}%`,
  } as CSSProperties;

  const motionProps = {
    style,
    variants: OBJ_VARIANTS,
    initial: "hidden",
    animate: state,
    transition,
    onAnimationComplete: () => setLanded(true),
    onMouseEnter: () => onHover(true),
    onMouseLeave: () => onHover(false),
  };

  const art = (
    <motion.span
      className="lift"
      style={{ rotate: item.rotate }}
      variants={ART_VARIANTS}
      transition={transition}
    >
      {children}
    </motion.span>
  );

  return item.section ? (
    <motion.button
      className="obj"
      onClick={onOpen}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      aria-label={`Open ${item.label.replace("./", "")}`}
      {...motionProps}
    >
      {art}
      <span className="tip">{item.label}</span>
    </motion.button>
  ) : (
    <motion.div className="obj deco" {...motionProps}>
      {art}
    </motion.div>
  );
}

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
            {ITEMS.map((it, i) => (
              <DeskObj
                key={it.id}
                item={it}
                index={i}
                hovered={hover === it.id}
                onHover={(on) =>
                  setHover((h) => (on ? it.id : h === it.id ? null : h))
                }
                onOpen={it.section ? openFrom(it.section) : undefined}
              >
                <DeskArt
                  asset={DESK_ASSETS[it.id]}
                  fallback={it.art}
                  widthPct={it.width}
                  hovered={hover === it.id}
                />
              </DeskObj>
            ))}
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
