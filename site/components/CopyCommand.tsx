"use client";

/**
 * The install command with a copy button — the one interactive element the
 * page's argument actually needs. A command you have to select by hand with
 * the cursor is a command that gets retyped, and a retyped `curl | sh` with a
 * typo'd URL is somebody else's shell script.
 */

import { useRef, useState } from "react";

export function CopyCommand({
  command,
  className = "",
}: {
  command: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      // Clipboard API needs a secure context; plain-HTTP previews get the
      // legacy path so the button never silently does nothing.
      const scratch = document.createElement("textarea");
      scratch.value = command;
      scratch.setAttribute("readonly", "");
      scratch.style.position = "absolute";
      scratch.style.left = "-9999px";
      document.body.appendChild(scratch);
      scratch.select();
      document.execCommand("copy");
      scratch.remove();
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className={`mn-oneliner ${className}`.trim()}>
      <code>{command}</code>
      <button
        type="button"
        className={copied ? "mn-copy is-copied" : "mn-copy"}
        onClick={copy}
        aria-label="Copy the install command"
      >
        {copied ? (
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2.5 7.6l3.1 3.1L11.5 4" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4.8" y="4.8" width="7" height="7" rx="1.4" />
            <path d="M9.2 4.8V3.6A1.4 1.4 0 0 0 7.8 2.2H3.6a1.4 1.4 0 0 0-1.4 1.4v4.2a1.4 1.4 0 0 0 1.4 1.4h1.2" />
          </svg>
        )}
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}
