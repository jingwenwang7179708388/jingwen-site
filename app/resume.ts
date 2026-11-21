"use client";

import { useEffect, useState } from "react";
import { LINKS } from "./content";

// 简历：public/resume.pdf 存在时，用 pdf.js 把第一页渲染成图片（放大的白纸上显示）。
// 文件不存在时 status 为 "missing"：纸上显示 "Resume coming soon"，下载按钮隐藏。
export type Resume =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; img?: string; w?: number; h?: number };

let cached: Promise<Resume> | null = null;

async function load(): Promise<Resume> {
  const head = await fetch(LINKS.resume, { method: "HEAD", cache: "no-store" }).catch(() => null);
  if (!head?.ok || !(head.headers.get("content-type") ?? "").includes("pdf")) return { status: "missing" };
  try {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    const task = pdfjs.getDocument({ url: LINKS.resume });
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1600 / page.getViewport({ scale: 1 }).width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    task.destroy();
    if (!blob) return { status: "ready" };
    return { status: "ready", img: URL.createObjectURL(blob), w: canvas.width, h: canvas.height };
  } catch {
    // PDF 在，但渲染失败：按钮照常显示，纸上不放预览
    return { status: "ready" };
  }
}

export function useResume(enabled: boolean): Resume {
  const [state, setState] = useState<Resume>({ status: "loading" });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    cached ??= load();
    cached.then((r) => live && setState(r));
    return () => {
      live = false;
    };
  }, [enabled]);
  return state;
}
