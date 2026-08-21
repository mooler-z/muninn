/** Mirrors the Rust types in `crates/muninn-core/src/event.rs`. */

export type Source = "claude-code" | "codex";
export type Kind = "completed" | "needs-input" | "failed";

export interface Changed {
  path: string | null;
  note: string;
}

export interface Summary {
  done: string | null;
  changed: Changed[];
  /** What the agent *says* it checked. Never rendered as Muninn's own finding. */
  verified: string | null;
  next: string | null;
  blocked: string | null;
  risk: string | null;
  /** The long-form account, for the details window. Never shown on the panel. */
  explain: string | null;
  extra: [string, string][];
}

export interface MuninnEvent {
  id: string;
  source: Source;
  sessionId: string | null;
  promptId: string | null;
  /** What was asked, once recovered. Kept on the event so history does not
   *  depend on Claude Code's transcript still being there. */
  prompt: string | null;
  transcriptPath: string | null;
  cwd: string | null;
  project: string | null;
  gitBranch: string | null;
  kind: Kind;
  receivedAt: string;
  summary: Summary | null;
  raw: string;
}

export interface View {
  event: MuninnEvent;
  /** 1-based, for the pager. */
  position: number;
  total: number;
  /** `raw` rendered to HTML and stripped of raw tags by `src-tauri/src/markdown.rs`. */
  rawHtml: string;
  /** `explain` rendered the same way. */
  explainHtml: string;
}
