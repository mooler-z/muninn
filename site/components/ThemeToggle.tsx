"use client";

/**
 * Light / dark, or neither.
 *
 * "Neither" is the initial state and it is not a third option in the toggle —
 * it means no attribute is set and the stylesheet is following the system. The
 * first press writes an explicit choice, and from then on the page keeps it.
 *
 * Which icon shows is decided in CSS, not here, so it is right on the very
 * first paint — before this component has hydrated and before it knows what
 * the system preference is.
 */

import { useCallback } from "react";

export function ThemeToggle() {
  const toggle = useCallback(() => {
    const root = document.documentElement;
    const current =
      root.getAttribute("data-theme") ??
      (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    const next = current === "dark" ? "light" : "dark";

    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem("mn-theme", next);
    } catch {
      // Private browsing. The choice still applies for this page view.
    }
  }, []);

  return (
    <button type="button" className="mn-glass mn-round" onClick={toggle} aria-label="Toggle appearance">
      <svg
        className="mn-icon-sun"
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="7" cy="7" r="3" />
        <path d="M7 0.8v1.6M7 11.6v1.6M0.8 7h1.6M11.6 7h1.6M2.6 2.6l1.1 1.1M10.3 10.3l1.1 1.1M11.4 2.6l-1.1 1.1M3.7 10.3l-1.1 1.1" />
      </svg>
      <svg
        className="mn-icon-moon"
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 8.6A5.6 5.6 0 116.2 1.6a4.4 4.4 0 005.8 7z" />
      </svg>
    </button>
  );
}
