"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import type { DeskAsset } from "./assets";

// 桌上单个物件的画面：有生成图就用图，没有就用 SVG；有视频就在悬停时播放。
export function DeskArt({
  asset,
  fallback,
  widthPct,
  hovered,
}: {
  asset?: DeskAsset;
  fallback: ReactNode;
  widthPct: number;
  hovered: boolean;
}) {
  const reduce = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoReady, setVideoReady] = useState(false);

  // 悬停开始 → 播放；结束 → 暂停并回到第一帧
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (hovered) {
      v.play().catch(() => {});
    } else {
      v.pause();
      v.currentTime = 0;
    }
  }, [hovered]);

  if (!asset?.image) return <>{fallback}</>;

  const { src, w, h } = asset.image;
  // 桌面最宽 1200px，物件占桌面 widthPct%
  const sizes = `(max-width: 1240px) ${widthPct}vw, ${Math.round(widthPct * 12)}px`;

  return (
    <span className="art">
      <Image src={src} alt="" width={w} height={h} sizes={sizes} />
      {asset.video && !reduce && (
        <video
          ref={videoRef}
          src={asset.video}
          muted
          loop
          playsInline
          preload="metadata"
          onCanPlay={() => setVideoReady(true)}
          className={hovered && videoReady ? "on" : ""}
          aria-hidden="true"
        />
      )}
    </span>
  );
}
