"use client";

import Image from "next/image";
import { ABOUT_PHOTO } from "./assets";
import { ExperienceCards, SkillCards } from "./cards";
import { LINKS, type Section } from "./content";
import type { Resume } from "./resume";

// 书桌模式里点开物件后，右侧面板里的内容。
// 没有单独写的栏目（projects / experiments / photo-to-short）直接用 content.tsx 里的内容。
export function PanelBody({ section, resume }: { section: Section; resume: Resume }) {
  switch (section.id) {
    case "skills":
      return <SkillCards drop />;
    case "experience":
      return <ExperienceCards drop />;
    case "resume":
      return <ResumeView resume={resume} />;
    case "about":
      return (
        <div className="about">
          <AboutPhoto />
          <div>{section.body}</div>
        </div>
      );
    case "contact":
      return <PhoneScreen />;
    default:
      return section.body;
  }
}

function AboutPhoto() {
  const { src, alt = "", w, h, crop } = ABOUT_PHOTO;
  if (!crop) {
    return (
      <figure className="about-photo">
        <Image src={src} alt={alt} fill sizes="(max-width: 760px) 90vw, 24vw" />
      </figure>
    );
  }
  const [x0, y0, x1, y1] = crop;
  const cw = x1 - x0;
  const ch = y1 - y0;
  return (
    <figure className="about-photo" style={{ "--photo-ar": `${cw} / ${ch}` } as React.CSSProperties}>
      <Image
        className="crop"
        src={src}
        alt={alt}
        width={w}
        height={h}
        sizes="(max-width: 760px) 100vw, 30vw"
        style={{
          left: `${(-x0 / cw) * 100}%`,
          top: `${(-y0 / ch) * 100}%`,
          width: `${(w / cw) * 100}%`,
          height: `${(h / ch) * 100}%`,
        }}
      />
    </figure>
  );
}

// resume：左边约 60% 是简历第一页（像一张纸放在面板里），右边一张小卡片和两个按钮。
// resume.pdf 还没有时：纸上写 "Resume coming soon"，按钮变灰不可点。
function ResumeView({ resume }: { resume: Resume }) {
  const ready = resume.status === "ready";
  const img = ready ? resume : null;
  return (
    <div className="resume">
      <div
        className="resume-paper"
        style={img?.w && img.h ? ({ "--paper-ar": `${img.w} / ${img.h}` } as React.CSSProperties) : undefined}
      >
        {img?.img ? (
          // blob 地址，不经过 next/image
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img.img} alt="Resume, page 1" />
        ) : resume.status === "missing" ? (
          <span className="resume-soon">Resume coming soon</span>
        ) : null}
      </div>
      <aside className="resume-card">
        <p className="resume-title">resume · 1 page · pdf</p>
        {ready ? (
          <>
            <a className="btn" href={LINKS.resume} download>
              Download resume ↓
            </a>
            <a className="btn ghost" href={LINKS.resume} target="_blank" rel="noreferrer">
              Open in a new tab ↗
            </a>
          </>
        ) : (
          <>
            <button className="btn" disabled>
              Download resume ↓
            </button>
            <button className="btn ghost" disabled>
              Open in a new tab ↗
            </button>
          </>
        )}
      </aside>
    </div>
  );
}

function PhoneScreen() {
  const links = [
    { label: "Email", detail: LINKS.email, href: `mailto:${LINKS.email}`, external: false },
    { label: "LinkedIn", detail: "Open profile ↗", href: LINKS.linkedin, external: true },
    { label: "GitHub", detail: LINKS.github.replace("https://", "") + " ↗", href: LINKS.github, external: true },
  ];
  return (
    <div className="phone">
      <div className="phone-screen">
        <span className="phone-notch" aria-hidden="true" />
        {links.map((l) => (
          <a
            key={l.label}
            className="phone-btn"
            href={l.href}
            {...(l.external ? { target: "_blank", rel: "noreferrer" } : {})}
          >
            <b>{l.label}</b>
            <span>{l.detail}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
