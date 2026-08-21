"use client";

/**
 * Click-to-zoom for the screenshots.
 *
 * One island for the whole page, wired by delegation rather than by wrapping
 * every figure: any `.mn-shot img` becomes zoomable, including ones added
 * later, and the page markup stays plain `<img>` tags a crawler understands.
 *
 * The zoomed view is the same file, just larger — the shots are shipped at
 * roughly 2× their inline size precisely so there is something real to zoom
 * into.
 */

import { useEffect, useState } from "react";

type Shot = { src: string; alt: string };

export function ShotLightbox() {
  const [shot, setShot] = useState<Shot | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const img = target?.closest?.(".mn-shot img") as HTMLImageElement | null;
      if (!img) return;
      setShot({ src: img.currentSrc || img.src, alt: img.alt });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (!shot) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShot(null);
    };
    document.addEventListener("keydown", onKey);
    // The page must not scroll behind the overlay.
    const { documentElement } = document;
    const previous = documentElement.style.overflow;
    documentElement.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      documentElement.style.overflow = previous;
    };
  }, [shot]);

  if (!shot) return null;

  return (
    <div
      className="mn-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={shot.alt || "Screenshot, enlarged"}
      onClick={() => setShot(null)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={shot.src} alt={shot.alt} />
      {shot.alt ? <p className="mn-lightbox-caption">{shot.alt}</p> : null}
      <button
        type="button"
        className="mn-lightbox-close"
        aria-label="Close"
        onClick={() => setShot(null)}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <path d="M3 3l8 8M11 3l-8 8" />
        </svg>
      </button>
    </div>
  );
}
