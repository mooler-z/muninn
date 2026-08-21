/**
 * The summary arriving.
 *
 * The agent's opening sentence streams the way its output does in a terminal,
 * and the supporting fields settle in behind it.
 *
 * Shared by the panel window and the fixtures harness so there is one
 * implementation rather than two that drift. It works on any rendered panel,
 * whatever state it is in — including the raw fallback, where the lead sentence
 * is the first paragraph of rendered markdown rather than a `.mn-headline`.
 *
 * Every character is in the document from the first frame and only its opacity
 * advances. Appending text as it types would reflow the paragraph on every
 * character, and since the window sizes itself to its content that would mean
 * resizing it sixty times a second.
 */

/** Per character. Fast — this is a reveal, not a performance. */
const CHAR_MS = 16;
/** However long the sentence, it is fully readable by this point. */
const STREAM_CAP_MS = 1100;
/** Between the supporting fields as they settle in behind the lead. */
const BLOCK_STAGGER_MS = 70;

const stillness = window.matchMedia("(prefers-reduced-motion: reduce)");

/** Cancels an in-flight stream. Safe to call more than once. */
export type Cancel = () => void;

/**
 * Find the elements to reveal, in the order they should appear.
 *
 * `.mn-raw` is expanded into its own children: in the fallback state the whole
 * summary is one markdown block, and staggering it as a single unit would mean
 * the entire panel appearing at once while every other state streams.
 */
function units(panel: Element): HTMLElement[] {
  const scroll = panel.querySelector(".mn-scroll");
  if (!scroll) return [];

  return [...scroll.children].flatMap((child) =>
    child.classList.contains("mn-raw")
      ? ([...child.children] as HTMLElement[])
      : [child as HTMLElement],
  );
}

/**
 * The one sentence that gets typed out.
 *
 * `.mn-headline` in every structured state; in the raw fallback it is the first
 * paragraph, which the stylesheet already sets in headline type.
 */
function lead(panel: Element, all: HTMLElement[]): HTMLElement | null {
  const headline = panel.querySelector<HTMLElement>(".mn-headline");
  if (headline) return headline;
  return all.find((el) => el.tagName === "P") ?? null;
}

export function streamPanel(panel: Element): Cancel {
  const all = units(panel);
  if (all.length === 0) return () => {};

  if (stillness.matches) return () => {};

  const sentence = lead(panel, all);
  const text = sentence?.textContent ?? "";
  const duration = Math.min(STREAM_CAP_MS, Math.max(text.length, 1) * CHAR_MS);
  const leadIndex = sentence ? all.indexOf(sentence) : -1;

  all.forEach((block, i) => {
    if (block === sentence) return;
    // What sits above the lead (the status row) arrives first; what sits below
    // waits for the sentence to finish, so nothing competes with it.
    const below = leadIndex >= 0 && i > leadIndex;
    const delay = below ? duration + (i - leadIndex - 1) * BLOCK_STAGGER_MS : i * BLOCK_STAGGER_MS;
    block.style.animationDelay = `${delay}ms`;
    block.classList.add("mn-block-in");
  });

  if (!sentence || !text) return () => {};
  return typeOut(sentence, text, duration);
}

function typeOut(host: HTMLElement, text: string, duration: number): Cancel {
  // Split by code point, so an emoji or accented character is one unit rather
  // than a pair of broken halves.
  const spans = [...text].map((ch) => {
    const span = document.createElement("span");
    span.className = "mn-char";
    span.textContent = ch;
    return span;
  });
  host.replaceChildren(...spans);

  const started = performance.now();
  let revealed = 0;
  let frame: number | undefined;

  const step = (now: number) => {
    const progress = Math.min(1, (now - started) / duration);
    const target = Math.round(progress * spans.length);
    for (; revealed < target; revealed++) spans[revealed]?.classList.add("is-in");

    frame = progress < 1 ? requestAnimationFrame(step) : undefined;
  };

  frame = requestAnimationFrame(step);

  return () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    // Leave the text readable rather than half-arrived.
    for (; revealed < spans.length; revealed++) spans[revealed]?.classList.add("is-in");
  };
}
