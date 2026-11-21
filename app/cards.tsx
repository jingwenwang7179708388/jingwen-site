"use client";

import { motion, useReducedMotion } from "motion/react";

// ====== 技能：5 张竖向卡片（书桌模式在笔记本面板里，阅读模式在 skills 栏目里）======
type SkillGroup = { no: string; name: string; main: string[]; more: string[] };

export const SKILLS: SkillGroup[] = [
  {
    no: "01",
    name: "Generative AI",
    main: ["Stable Diffusion XL", "Hugging Face Diffusers", "Image-to-Video (LTX-Video, Wan 2.2)"],
    more: ["IP-Adapter", "Text-to-Speech", "Real-ESRGAN", "rembg", "Blender (bpy)"],
  },
  {
    no: "02",
    name: "LLMs & Agents",
    main: ["GPT-4o API", "LangChain", "RAG"],
    more: ["Structured outputs", "Prompt engineering", "LLM-based scoring", "Claude Code"],
  },
  {
    no: "03",
    name: "ML & Retrieval",
    main: ["PyTorch", "LightGBM (LambdaMART)", "Sentence-Transformers"],
    more: [
      "YOLOv5", "Hybrid search (BM25 + embeddings)", "Pinecone", "FAISS", "scikit-learn",
      "TensorFlow/Keras", "Offline evaluation",
    ],
  },
  {
    no: "04",
    name: "Backend & data",
    main: ["Python", "FastAPI", "Flask"],
    more: ["Redis", "MongoDB", "MySQL", "PostgreSQL", "SQL", "Apache Spark"],
  },
  {
    no: "05",
    name: "Frontend & tooling",
    main: ["JavaScript", "React", "Next.js"],
    more: ["TypeScript", "Motion", "Git", "Vercel", "AWS", "ffmpeg"],
  },
];

// 卡片颜色取自场景：深灰（笔记本）、奶白、淡蓝（屏幕）、银灰（电脑外壳）
const SKILL_TONES = ["dark", "cream", "blue", "silver", "cream"];
const SKILL_TILTS = [-2.2, 1.4, -0.8, 1.8, -1.4];

// drop = true：依次从上方落下（书桌面板里用）
export function SkillCards({ drop = false }: { drop?: boolean }) {
  const reduce = useReducedMotion();
  const fall = drop && !reduce;
  return (
    <ol className="skills">
      {SKILLS.map((g, i) => (
        <motion.li
          key={g.no}
          className={`skill tone-${SKILL_TONES[i]}`}
          initial={drop ? (fall ? { opacity: 0, y: -70, rotate: 0 } : { opacity: 0 }) : false}
          animate={{ opacity: 1, y: 0, rotate: SKILL_TILTS[i] }}
          transition={
            fall
              ? { delay: 0.62 + i * 0.07, type: "spring", stiffness: 260, damping: 24 }
              : { delay: drop ? 0.5 : 0, duration: 0.25 }
          }
        >
          <span className="skill-no">{g.no}</span>
          <h3>{g.name}</h3>
          <ul className="skill-main">
            {g.main.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <p className="skill-more">{g.more.join(" · ")}</p>
        </motion.li>
      ))}
    </ol>
  );
}

// ====== 经历：证件样式的卡片，最新的在最上面 ======
type Role = { role: string; org: string; dates: string; place: string; text: string };

export const EXPERIENCE: Role[] = [
  {
    role: "Graduate Student Researcher",
    org: "Integrated Media Systems Center, USC",
    dates: "Jan 2026 – Present",
    place: "Los Angeles",
    text:
      "Fine-tuned YOLOv5 on 800 annotated Street View images to detect homeless encampments (0.82 mAP@0.5). Geolocated detections across 2,600+ images and merged duplicates, lifting precision from 0.77 to 0.83.",
  },
  {
    role: "Quantitative Research Intern",
    org: "Beijing Zhongjin Technology Quantitative Co., Ltd.",
    dates: "Jun 2025 – Sep 2025", // TODO: confirm dates
    place: "Beijing",
    text:
      "Backtested a volatility-scaled breakout strategy on 10 futures products (1.8 Sharpe, 6.5% annualized), stress-tested with parameter perturbation, subsampling and return shuffling.",
  },
  {
    role: "Machine Learning Engineer Intern",
    org: "Beijing Jinshui Co., Ltd",
    dates: "Jul 2024 – Sep 2024",
    place: "Beijing",
    text:
      "Built a multi-step LSTM that forecasts river discharge 1–6 hours ahead from hourly rainfall at 8 gauge stations, beating a calibrated hydrological baseline by about 15% NSE on held-out floods.",
  },
];

export function ExperienceCards({ drop = false }: { drop?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <ol className="ids">
      {EXPERIENCE.map((r, i) => (
        <motion.li
          key={r.role}
          className="id-card"
          initial={drop ? (reduce ? { opacity: 0 } : { opacity: 0, y: 24 }) : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: drop ? 0.6 + i * 0.07 : 0, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="id-band" aria-hidden="true">
            <i />
          </span>
          <div className="id-body">
            <p className="id-meta">
              <span>{r.dates}</span>
              <span>{r.place}</span>
            </p>
            <h3>{r.role}</h3>
            <p className="id-org">{r.org}</p>
            <p className="id-text">{r.text}</p>
          </div>
        </motion.li>
      ))}
    </ol>
  );
}
