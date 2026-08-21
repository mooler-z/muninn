"use client";

/**
 * One page view, reported once.
 *
 * `sendBeacon` rather than `fetch`: it survives the page being closed or
 * navigated away from mid-request, which a plain fetch does not, and it is
 * explicitly allowed to run during unload. The failure path is silence — a
 * visitor who blocks this gets the page exactly as it is.
 *
 * The ref guard matters in development, where React's strict mode mounts every
 * component twice and would otherwise double every figure on the dashboard.
 */

import { useEffect, useRef } from "react";

export function Beacon({ path }: { path: string }) {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;

    const body = JSON.stringify({ path, referrer: document.referrer || null });

    try {
      const blob = new Blob([body], { type: "application/json" });
      if (!navigator.sendBeacon("/api/track", blob)) {
        void fetch("/api/track", { method: "POST", body, keepalive: true });
      }
    } catch {
      // Nothing to do, and nothing worth telling the visitor.
    }
  }, [path]);

  return null;
}
