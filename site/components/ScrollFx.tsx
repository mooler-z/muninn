"use client";

/**
 * Smooth scrolling and scroll-driven reveals.
 *
 * Lenis drives the scroll and GSAP's ScrollTrigger reads it. The two have to be
 * wired together deliberately — Lenis interpolates the scroll position between
 * native events, so ScrollTrigger listening to `scroll` on its own would update
 * on the browser's cadence rather than Lenis's and every pinned or scrubbed
 * animation would judder. Hence `lenis.on("scroll", ScrollTrigger.update)` and
 * running `lenis.raf` off GSAP's ticker, so there is exactly one loop.
 *
 * **Nothing here is required for the page to work.** Every animation is a
 * `gsap.from`, so the finished state is what is in the markup and what the
 * server sends — if this island fails to load, or the visitor has asked for
 * reduced motion, the page is simply the page. That is the right trade for a
 * product whose whole argument is that software should not demand attention.
 */

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { useEffect, useLayoutEffect } from "react";

// useLayoutEffect warns when it runs on the server; there is no server here,
// but Next still renders this component's tree once during SSR.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function ScrollFx() {
  useIsomorphicLayoutEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;

    gsap.registerPlugin(ScrollTrigger);

    const lenis = new Lenis({
      // Long enough to feel eased, short enough that the page still goes where
      // you threw it. Past about 1.4s a landing page starts feeling like it is
      // arguing with you.
      duration: 1.05,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      // Touch devices already have momentum scrolling, and layering ours on
      // top of theirs is what makes smooth-scroll libraries feel broken on a
      // phone.
      syncTouch: false,
    });

    lenis.on("scroll", ScrollTrigger.update);

    const drive = (time: number) => lenis.raf(time * 1000); // GSAP ticks in seconds
    gsap.ticker.add(drive);
    // Lag smoothing pauses the ticker after a stall, which would strand Lenis
    // mid-scroll on a slow frame.
    gsap.ticker.lagSmoothing(0);

    const context = gsap.context(() => {
      // --- the hero, on arrival ---------------------------------------------
      // Not scroll-driven: it is already on screen. A short cascade so the page
      // assembles rather than appearing.
      gsap.from("[data-intro]", {
        opacity: 0,
        y: 26,
        duration: 0.95,
        ease: "power3.out",
        stagger: 0.1,
      });

      // --- sections, as they arrive ------------------------------------------
      gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((element) => {
        gsap.from(element, {
          opacity: 0,
          y: 30,
          duration: 0.9,
          ease: "power3.out",
          scrollTrigger: {
            trigger: element,
            start: "top 86%",
            // Once. A section that re-animates every time it scrolls back into
            // view turns reading into a slideshow.
            once: true,
          },
        });
      });

      // --- lists, staggered --------------------------------------------------
      gsap.utils.toArray<HTMLElement>("[data-reveal-group]").forEach((group) => {
        gsap.from(Array.from(group.children), {
          opacity: 0,
          y: 24,
          duration: 0.75,
          ease: "power3.out",
          stagger: 0.1,
          scrollTrigger: { trigger: group, start: "top 84%", once: true },
        });
      });

      // --- parallax ----------------------------------------------------------
      // Scrubbed rather than triggered, so it tracks the scroll exactly. Small:
      // the panel should drift against the copy beside it, not swim.
      gsap.utils.toArray<HTMLElement>("[data-parallax]").forEach((element) => {
        gsap.to(element, {
          yPercent: -9,
          ease: "none",
          scrollTrigger: {
            trigger: element,
            start: "top bottom",
            end: "bottom top",
            scrub: 0.5,
          },
        });
      });

      // --- the honesty line --------------------------------------------------
      // The one deliberately theatrical moment on the page, on the one claim
      // the product is actually built around.
      gsap.from("[data-verified]", {
        opacity: 0,
        letterSpacing: "0.7em",
        duration: 1.2,
        ease: "power4.out",
        scrollTrigger: { trigger: "[data-verified]", start: "top 78%", once: true },
      });
    });

    // Late-loading fonts and images change every trigger's position.
    const refresh = () => ScrollTrigger.refresh();
    document.fonts?.ready.then(refresh);

    return () => {
      context.revert();
      gsap.ticker.remove(drive);
      lenis.destroy();
    };
  }, []);

  return null;
}
