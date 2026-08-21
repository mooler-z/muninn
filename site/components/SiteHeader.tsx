"use client";

/**
 * The fixed header.
 *
 * Transparent while you are at the top of the page and condensed onto a
 * blurred bar once you have left it. The state is a single class, so the
 * transition is CSS's job and this only decides when.
 *
 * Read from `window.scrollY` rather than from Lenis: Lenis drives the real
 * window scroll, so the two agree, and the header keeps working on its own if
 * the smooth-scroll island never loads.
 */

import { useEffect, useState } from "react";

import { ThemeToggle } from "./ThemeToggle";

/** Far enough that a trackpad twitch does not flip the bar in and out. */
const THRESHOLD = 28;

export function SiteHeader() {
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    let frame = 0;

    const onScroll = () => {
      // Coalesced to one read per frame: a scroll listener that touches
      // scrollY on every event forces layout far more often than it needs to.
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setStuck(window.scrollY > THRESHOLD);
      });
    };

    onScroll(); // the page may be restored mid-scroll on a back navigation
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <header className={stuck ? "mn-header is-stuck" : "mn-header"}>
      <div className="mn-header-inner">
        <span className="mn-brand">
          <span className="mn-logo mn-logo--nav" aria-hidden="true" />
          <span className="mn-brand-name">Muninn</span>
        </span>
        <span className="mn-nav-side">
          <a className="mn-nav-link" href="#install">
            Install
          </a>
          <ThemeToggle />
        </span>
      </div>
    </header>
  );
}
