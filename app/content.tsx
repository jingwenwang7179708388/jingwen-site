import Image from "next/image";
import type { ReactNode } from "react";
import { DEMO, MAKING, PHOTOS } from "./assets";
import { ExperienceCards, SkillCards } from "./cards";

// ====== 你的链接：改这里 ======
export const LINKS = {
  email: "jwang426@usc.edu",
  github: "https://github.com/jingwenwang7179708388",
  linkedin: "#", // 换成你的 LinkedIn 链接
  resume: "/resume.pdf", // 把简历 PDF 放进 public 文件夹，命名为 resume.pdf
  hax: "https://github.com/gnauhuhsaij/hax",
  recommender: "#", // 换成推荐系统的 GitHub 链接
  photos: "#", // 换成摄影作品集链接
};

export type SectionId =
  | "projects"
  | "experience"
  | "skills"
  | "demo"
  | "about"
  | "now"
  | "photos"
  | "resume"
  | "contact"
  | "experiments"
  | "making";

export type Section = {
  id: SectionId;
  title: string;
  body: ReactNode;
  wide?: boolean; // 窗口加宽（项目页用）
  inDock?: boolean; // false = 不出现在底部导航里
  hidden?: boolean; // true = 暂时隐藏：不出现在底部导航和阅读模式里（内容保留）
};

// ====== 实验记录：每做一个小实验就加一条，最新的放最上面 ======
// status: "shipped" 做出来了 / "dropped" 放弃了 / "exploring" 进行中
// media 可选：public/ 里的 gif、mp4 或图片路径
type Experiment = {
  date: string;
  title: string;
  status: "shipped" | "dropped" | "exploring";
  note: string;
  media?: string;
  link?: string;
};

export const EXPERIMENTS: Experiment[] = [
  // 模板：
  // {
  //   date: "2026-11-20",
  //   title: "LoRA vs IP-Adapter for character consistency",
  //   status: "shipped",
  //   note: "LoRA kept the face across 3 shots; IP-Adapter drifted on profile views. Going with LoRA, 12 images, ~20 min on one GPU.",
  //   media: "/experiments/lora-vs-ipa.mp4",
  // },
  {
    date: "2026-11",
    title: "Photo to Short: scoping the first version",
    status: "exploring",
    note: "Picking models for keyframes, consistency and image-to-video. Scope: one photo, one line, three shots.",
  },
];

// ====== photo-to-short 的流程（按实际用到的改）======
const PIPELINE: { step: string; what: string; tools: string }[] = [
  { step: "Plan", what: "An LLM turns the photo and one line into a three-shot plan.", tools: "LLM" },
  { step: "Keyframes", what: "Generate one keyframe per shot.", tools: "FLUX / SDXL · ComfyUI or Diffusers" },
  { step: "Same character", what: "Keep the person from the photo consistent across shots.", tools: "LoRA (PEFT) · IP-Adapter" },
  { step: "Motion", what: "Animate each keyframe into a short clip.", tools: "Pika API · Wan · LTX-Video" },
  { step: "Voice", what: "Add a voice track from the script.", tools: "Text-to-Speech" },
  { step: "Assemble", what: "Cut clips and audio into one postable short.", tools: "ffmpeg" },
  { step: "Try it", what: "A page where anyone can upload a photo and get a short.", tools: "Gradio" },
];

// ====== 做完后填：关键取舍和数字。空着就不显示 ======
const DECISIONS: { q: string; a: string }[] = [
  // { q: "Why LoRA over IP-Adapter?", a: "..." },
];
const NUMBERS: { label: string; value: string }[] = [
  // { label: "Time per short", value: "~4 min" },
  // { label: "Cost per short", value: "$0.30" },
];

const STATUS_LABEL: Record<Experiment["status"], string> = {
  shipped: "shipped",
  dropped: "dropped",
  exploring: "in progress",
};

function Media({ src, poster }: { src: string; poster?: string }) {
  if (/\.(mp4|webm|mov)$/i.test(src)) {
    return (
      <video
        className="media"
        src={src}
        poster={poster || undefined}
        controls
        muted
        loop
        playsInline
        preload="metadata"
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="media" src={src} alt="" loading="lazy" />;
}

function Project({
  name,
  tag,
  children,
  note,
  link,
  linkLabel = "Code",
}: {
  name: string;
  tag: string;
  children: ReactNode;
  note?: string;
  link?: string;
  linkLabel?: string;
}) {
  return (
    <article className="proj">
      <div className="proj-top">
        <h3>{name}</h3>
        <span className="chip">{tag}</span>
      </div>
      <p>{children}</p>
      {note && <p className="note">{note}</p>}
      {link && (
        <a className="textlink" href={link} target="_blank" rel="noreferrer">
          {linkLabel} ↗
        </a>
      )}
    </article>
  );
}

export const SECTIONS: Section[] = [
  {
    id: "projects",
    title: "projects",
    body: (
      <div className="stack">
        <Project
          name="HaX"
          tag="Co-founder · startup"
          link={LINKS.hax}
          note="Most fixes came from reading execution logs, finding where a workflow broke or confused people, and reworking how tasks get split up."
        >
          People describe a vague goal; HaX turns it into a step-by-step
          workflow and runs it. I built the stack end to end: GPT-4o +
          LangChain planning, a retrieval layer for evidence, a Flask API and a
          web front end, demoed on AWS.
        </Project>
        <Project
          name="Sponsor-aware job finder"
          tag="Personal tool · 2026"
          link={LINKS.recommender}
          note="Recall@100 0.72 → 0.88 · NDCG@10 0.44 → 0.57 in offline evaluation."
        >
          International new grads waste hours on jobs that will never sponsor a
          visa. I joined 4.27M H-1B filings with live postings from 7 job
          boards, then ranked matches with hybrid search, LLM scoring and a
          learned reranker. I use it in my own job search.
        </Project>
        <Project
          name="Seeing encampments"
          tag="USC research"
          note="The same tent shows up in many photos. Matching them by location and visual similarity lifted precision from 0.77 to 0.83."
        >
          At USC&apos;s Integrated Media Systems Center I fine-tuned a detector on
          Street View images I annotated myself (0.82 mAP@0.5), then placed each
          detection on the map and merged duplicates seen from different
          angles.
        </Project>
      </div>
    ),
  },
  {
    id: "experience",
    title: "experience",
    body: <ExperienceCards />,
  },
  {
    id: "skills",
    title: "skills",
    body: <SkillCards />,
  },
  {
    id: "demo",
    title: "photo-to-short",
    wide: true,
    body: (
      <div className="stack">
        <span className="chip live">Building now · Nov 2026</span>
        <p className="lead">
          Upload one photo, write one line. An LLM plans three shots, keyframes
          keep the character consistent, then image-to-video and a voice track
          turn it into a clip you can post.
        </p>

        {DEMO.video ? (
          <Media src={DEMO.video} poster={DEMO.poster} />
        ) : (
          <div className="slot">first short lands here</div>
        )}

        {DEMO.steps.length > 0 && (
          <div className="strip">
            {DEMO.steps.map((img, i) => (
              <figure key={img.src}>
                <Image src={img.src} alt={img.alt ?? ""} width={img.w} height={img.h} sizes="200px" />
                <figcaption>{i === 0 ? "input" : `shot ${i}`}</figcaption>
              </figure>
            ))}
          </div>
        )}

        <h4 className="sub">Pipeline</h4>
        <ol className="pipe">
          {PIPELINE.map((p) => (
            <li key={p.step}>
              <b>{p.step}</b>
              <span>{p.what}</span>
              <code>{p.tools}</code>
            </li>
          ))}
        </ol>

        {NUMBERS.length > 0 && (
          <div className="nums">
            {NUMBERS.map((n) => (
              <div key={n.label}>
                <strong>{n.value}</strong>
                <span>{n.label}</span>
              </div>
            ))}
          </div>
        )}

        {DECISIONS.length > 0 && (
          <>
            <h4 className="sub">Decisions</h4>
            <dl className="qa">
              {DECISIONS.map((d) => (
                <div key={d.q}>
                  <dt>{d.q}</dt>
                  <dd>{d.a}</dd>
                </div>
              ))}
            </dl>
          </>
        )}

        {DEMO.gradio && (
          <>
            <h4 className="sub">Try it</h4>
            <iframe className="gradio" src={DEMO.gradio} title="Photo to Short demo" loading="lazy" allow="clipboard-write" />
          </>
        )}

        <div className="row">
          {DEMO.repo && (
            <a className="btn" href={DEMO.repo} target="_blank" rel="noreferrer">
              Code + workflow ↗
            </a>
          )}
          {DEMO.gradio && (
            <a className="btn ghost" href={DEMO.gradio} target="_blank" rel="noreferrer">
              Open demo ↗
            </a>
          )}
        </div>
        {!DEMO.repo && !DEMO.gradio && (
          <p className="note">Demo, code and a write-up of what worked and what broke are coming.</p>
        )}
      </div>
    ),
  },
  {
    id: "experiments",
    title: "experiments",
    body: (
      <div className="stack">
        <p className="lead">
          Small, fast tests. Each one gets a scope, a result, and a call:
          keep going or stop.
        </p>
        <ul className="exps">
          {EXPERIMENTS.map((e) => (
            <li key={e.date + e.title}>
              <div className="exp-top">
                <time>{e.date}</time>
                <span className={`chip st-${e.status}`}>{STATUS_LABEL[e.status]}</span>
              </div>
              <h3>{e.title}</h3>
              <p>{e.note}</p>
              {e.media && <Media src={e.media} />}
              {e.link && (
                <a className="textlink" href={e.link} target="_blank" rel="noreferrer">
                  More ↗
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>
    ),
  },
  {
    id: "about",
    title: "about",
    body: (
      <div className="stack">
        <p className="lead">
          I&apos;m Jingwen. I study applied data science at USC, I co-founded a
          small LLM workflow startup, and I like turning new models into things
          people can actually try. I ship a rough version first, watch where it
          breaks, then fix that.
        </p>
        <dl className="facts">
          <div>
            <dt>Now</dt>
            <dd>M.S. Applied Data Science, USC · May 2027</dd>
          </div>
          <div>
            <dt>Before</dt>
            <dd>B.S. Applied Mathematics, UC Santa Barbara</dd>
          </div>
          <div>
            <dt>Based in</dt>
            <dd>Los Angeles</dd>
          </div>
        </dl>
      </div>
    ),
  },
  {
    id: "now",
    title: "now",
    body: (
      <div className="stack">
        <p className="eyebrow">November 2026</p>
        <ul className="list">
          <li>
            Finishing Photo to Short: LoRA for character consistency,
            image-to-video, voice.
          </li>
          <li>Second year of my M.S. at USC, graduating May 2027.</li>
          <li>
            Looking for applied and creative AI roles: internships for 2027,
            full time from May 2027.
          </li>
        </ul>
      </div>
    ),
  },
  {
    id: "photos",
    title: "photos",
    hidden: true, // 照片还没放，先隐藏
    body: (
      <div className="stack">
        <p className="lead">
          I shoot photos and short videos. It&apos;s where most of my taste for
          what looks good on a phone screen comes from.
        </p>
        {PHOTOS.length > 0 && (
          <div className="gallery">
            {PHOTOS.map((p) => (
              <Image key={p.src} src={p.src} alt={p.alt ?? ""} width={p.w} height={p.h} sizes="(max-width: 760px) 50vw, 220px" />
            ))}
          </div>
        )}
        {LINKS.photos !== "#" && (
          <a className="btn" href={LINKS.photos} target="_blank" rel="noreferrer">
            See more photos ↗
          </a>
        )}
      </div>
    ),
  },
  {
    id: "resume",
    title: "resume.pdf",
    body: (
      <div className="stack">
        <p className="lead">One page, the usual format.</p>
        <a className="btn" href={LINKS.resume} target="_blank" rel="noreferrer">
          Open resume ↗
        </a>
      </div>
    ),
  },
  {
    id: "contact",
    title: "contact",
    body: (
      <div className="stack">
        <p className="lead">Easiest way to reach me is email.</p>
        <p className="big">{LINKS.email}</p>
        <div className="row">
          <a className="btn" href={`mailto:${LINKS.email}`}>
            Email me
          </a>
          <a className="btn ghost" href={LINKS.github} target="_blank" rel="noreferrer">
            GitHub ↗
          </a>
          <a className="btn ghost" href={LINKS.linkedin} target="_blank" rel="noreferrer">
            LinkedIn ↗
          </a>
        </div>
      </div>
    ),
  },
  {
    id: "making",
    title: "how-this-desk-was-made",
    wide: true,
    inDock: false,
    body: (
      <div className="stack">
        <p className="lead">
          Everything on this desk was generated with the same toolkit I use for
          Photo to Short.
        </p>
        <ol className="pipe">
          <li><b>Scene</b><span>The desk is built and lit in a Python script, then rendered at 4K.</span><code>Blender (bpy) · Cycles</code></li>
          <li><b>The photo</b><span>A real childhood photo, used as the texture on the print.</span><code>Blender</code></li>
          <li><b>Hotspots</b><span>Clickable areas computed from the 3D scene, so they always line up.</span><code>bpy · Next.js</code></li>
        </ol>
        {MAKING.length > 0 && (
          <div className="making">
            {MAKING.map((m) => (
              <figure key={m.src}>
                <Image src={m.src} alt={m.alt ?? m.caption} width={m.w} height={m.h} sizes="(max-width: 760px) 100vw, 420px" />
                <figcaption>{m.caption}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    ),
  },
];
