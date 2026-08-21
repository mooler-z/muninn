/**
 * The landing page.
 *
 * Ported from the Claude Design project file `Muninn Landing.dc.html`. The
 * design canvas ships inline styles throughout because that is what a canvas
 * is; this carries them into the semantic classes in `styles/site.css`.
 *
 * A server component with two client islands — the theme toggle and the view
 * beacon. Nothing else on the page needs JavaScript, which is the right shape
 * for a page whose own copy argues that idle cost is a feature.
 *
 * The panel and the Details window are built from the app's real geometry
 * rather than screenshotted, so they stay sharp at any density and follow the
 * visitor's theme.
 */

import { Beacon } from "@/components/Beacon";
import { ContributeFab } from "@/components/ContributeFab";
import { CopyCommand } from "@/components/CopyCommand";
import { ScrollFx } from "@/components/ScrollFx";
import { ShotLightbox } from "@/components/ShotLightbox";
import { SiteHeader } from "@/components/SiteHeader";

const DownloadIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M7 1.5v7.5M3.8 6L7 9.2 10.2 6M2 12.5h10" />
  </svg>
);

export default function Home() {
  return (
    <>
      <Beacon path="/" />
      <ScrollFx />
      <ShotLightbox />
      <ContributeFab />
      <a className="mn-skip" href="#main">
        Skip to content
      </a>

      <SiteHeader />

      <main id="main">
        {/* ============ 1 · hero ============ */}
        <div className="mn-shell">
          <section className="mn-hero-card">
          <div className="mn-hero-inner">
            {/* The eyebrow carries the local claim — the first thing read,
                the question every agent-adjacent tool must answer before it
                is allowed near a codebase. */}
            <p className="mn-hero-eyebrow" data-intro>
              <i aria-hidden="true" />
              100% local &middot; nothing leaves your PC
            </p>

            {/* Both halves of the problem as what you keep. The two nouns
                take the accent: they are the two things at stake, and the
                repetition is the argument. */}
            <h1 className="mn-hero-title" data-intro>
              <span className="mn-hero-line">
                Keep your <em>focus</em> while it works.
              </span>
              <span className="mn-hero-line">
                Keep your <em>code</em> when it&rsquo;s done.
              </span>
            </h1>

            <p className="mn-hero-sub" data-intro>
              Muninn is an open-source menu-bar companion for the coding agents that live in your
              terminal. It fills the wait with one thing to think about, then knocks the moment the
              turn lands &mdash; a single line on what your agent changed, and the reasoning under
              it. Claude Code today; any CLI agent is one small file away.
            </p>

            {/* The command is the call to action, as in the reference —
                a button that says "download" undersells an install that is
                genuinely one line. */}
            <div className="mn-hero-cmd" data-intro>
              <CopyCommand
                command="curl -fsSL https://muninn.moolerz.et/install.sh | sh"
                className="mn-oneliner--hero"
              />
            </div>
            <p className="mn-hero-fine" data-intro>
              installs the app, registers the hooks, teaches the format &middot;{" "}
              <a href="/api/download?from=hero">or just download the .zip</a> &middot;{" "}
              <a href="https://github.com/mooler-z/muninn">source on GitHub</a>
            </p>

            {/* Where the reference puts platforms and a licence. All true. */}
            <div className="mn-hero-strip" data-intro>
              <span>macOS menu bar</span>
              <i aria-hidden="true" />
              <span>Works offline</span>
              <i aria-hidden="true" />
              <span>Your agent never waits 500ms</span>
              <i aria-hidden="true" />
              <span>Open source &middot; MIT</span>
            </div>
          </div>
          </section>
        </div>

      {/* ============ 2 · the numbers ============
          Directly under the hero, where the reference puts stars and installs.
          Muninn has neither and is not going to invent them, so the row states
          what the thing is: four hard facts before the argument starts. */}
      <div className="mn-wrap">
        <section className="mn-stats-band" data-reveal>
          <div className="mn-spec mn-spec--band" data-reveal-group>
            <div className="mn-spec-card">
              <p className="mn-spec-figure">
                1<small>window</small>
              </p>
              <span className="mn-spec-label">However many agents</span>
              <p className="mn-spec-note">
                Two agents finishing together do not stack two windows. They queue behind one
                panel with a count you can page through.
              </p>
            </div>

            <div className="mn-spec-card">
              <p className="mn-spec-figure">
                500<small>ms</small>
              </p>
              <span className="mn-spec-label">Hard cap on the hook</span>
              <p className="mn-spec-note">
                Zero dependencies and a watchdog that exits whatever happens. Your agent never
                pauses for Muninn.
              </p>
            </div>

            <div className="mn-spec-card mn-spec-card--accent">
              <p className="mn-spec-figure">0</p>
              <span className="mn-spec-label">Accounts, servers, telemetry</span>
              <p className="mn-spec-note">
                Read from a hook, written to a file on your disk. That is the entire journey your
                work makes.
              </p>
            </div>

            <div className="mn-spec-card">
              <p className="mn-spec-figure">2</p>
              <span className="mn-spec-label">Summaries per turn</span>
              <p className="mn-spec-note">
                One sentence for the glance, several paragraphs for the read. Your agent writes
                both; Muninn writes neither.
              </p>
            </div>
          </div>
        </section>

        {/* ============ 3 · the demo ============
            The reference gives its product one big full-width stage before a
            single feature is argued. Muninn's product is two windows; here
            they are, real geometry, at full size. */}
        <section className="mn-demo" data-reveal>
          <p className="mn-demo-caption mn-mono">the turn, read from across the room</p>
          <div className="mn-demo-stage mn-demo-stage--shots">
            <figure className="mn-shot mn-shot--window">
              <img src="/shots/details.png" alt="The Details window: a finished turn with the agent&rsquo;s full reasoning" width="1500" height="1041" loading="lazy" />
              <figcaption className="mn-fact">The read &middot; details window</figcaption>
            </figure>
            <figure className="mn-shot mn-shot--panel">
              <img src="/shots/panel-completed.jpg" alt="The panel in the top-right corner of a Mac desktop: finished, with the summary" width="1000" height="878" loading="lazy" />
              <figcaption className="mn-fact">The glance &middot; top-right, as it lands</figcaption>
            </figure>
          </div>
          <p className="mn-demo-note">
            The panel is the glance: did it work, do I need to act, what happens next. The window
            behind it is the read &mdash; your prompt, the mechanism, the claims. Both written by
            your agent; Muninn renders exactly that and never invents a word.
          </p>
        </section>

        {/* ============ 4 · five strips ============
            The features, the reference's way: numbered, compact, centred, one
            thought each. The mocks already made the visual case above — these
            only have to say why. */}
        <section className="mn-strips">
          <article className="mn-strip" data-reveal>
            <span className="mn-strip-eyebrow"><b>01</b><i aria-hidden="true" />The knock</span>
            <h2 className="mn-strip-title">
              So you <em>never have to check.</em>
            </h2>
            <p className="mn-strip-note">
              A terminal cannot tap you on the shoulder. Claude Code, Codex, every CLI agent
              &mdash; they all finish into a window you are not looking at, so you poll it, and
              every check is a context switch you paid for. Muninn knocks instead: three soft
              hits, evenly spaced, never escalating, and a lower sound when it is asking rather
              than finishing. The panel waits in the corner until you have seen it. It does not
              take focus, and it does not time out.
            </p>

            <div className="mn-shot-row" data-reveal-group>
              <figure className="mn-shot mn-shot--framed">
                <img src="/shots/panel-blocked.jpg" alt="The panel in its blocked state: the accent lights, the blocker takes the headline" width="1000" height="895" loading="lazy" />
                <figcaption className="mn-fact">Blocked &middot; the accent means you are needed</figcaption>
              </figure>
              <figure className="mn-shot mn-shot--framed">
                <img src="/shots/panel-needs-input.jpg" alt="The panel asking a question mid-turn" width="1000" height="639" loading="lazy" />
                <figcaption className="mn-fact">Needs input &middot; the quieter ask</figcaption>
              </figure>
            </div>
          </article>

          <article className="mn-strip" data-reveal>
            <span className="mn-strip-eyebrow"><b>02</b><i aria-hidden="true" />The contract</span>
            <h2 className="mn-strip-title">
              It doesn&rsquo;t guess. <em>It asks.</em>
            </h2>
            <p className="mn-strip-note">
              Your agent ends each turn with a structured block &mdash; <code
              className="mn-code">done</code>, <code className="mn-code">changed</code>,{" "}
              <code className="mn-code">verified</code>, <code className="mn-code">next</code>,{" "}
              <code className="mn-code">blocked</code>, <code className="mn-code">risk</code>,{" "}
              <code className="mn-code">explain</code> &mdash; and Muninn renders exactly that.
              No second model between you and the work. <a href="/MUNINN.md">MUNINN.md</a> teaches
              the format in one file; a missing summary says <em>finished, no summary</em>, never
              an invented one. And <span className="mn-claim">tests pass</span>, said by your
              agent, stays a quotation &mdash; Muninn quotes, it never vouches.
            </p>
          </article>

          <article className="mn-strip" data-reveal>
            <span className="mn-strip-eyebrow"><b>03</b><i aria-hidden="true" />The long half</span>
            <h2 className="mn-strip-title">
              So the code <em>stays yours.</em>
            </h2>
            <p className="mn-strip-note">
              <code className="mn-code">explain</code> is held to a standard: how it works, which
              function does what, the constraint that ruled the other approach out &mdash; then
              the name of the technique, so something transfers to a project this one never
              touched. After reading it you should be able to predict what the code does with an
              input you have not seen. That is the difference between accepting a change and
              understanding it.
            </p>
          </article>

          <article className="mn-strip" data-reveal>
            <span className="mn-strip-eyebrow"><b>04</b><i aria-hidden="true" />History</span>
            <h2 className="mn-strip-title">
              Every turn, kept &mdash; <em>with the prompt that caused it.</em>
            </h2>
            <p className="mn-strip-note">
              The last fifty turns in a plain JSON file on your own disk, each with the prompt
              that started it &mdash; a conversation, not a list of outcomes. Search ranks project
              names first and highlights the match inside the result; export any of it as
              markdown. The tray keeps the recent few to hand.
            </p>

            <figure className="mn-shot mn-shot--single" data-reveal>
              <img src="/shots/history.png" alt="The History window: six projects, each turn with its summary and time" width="1400" height="1295" loading="lazy" />
              <figcaption className="mn-fact">Kept on this Mac &middot; the last fifty turns</figcaption>
            </figure>
          </article>

          <article className="mn-strip" data-reveal>
            <span className="mn-strip-eyebrow"><b>05</b><i aria-hidden="true" />While you wait &middot; off by default</span>
            <h2 className="mn-strip-title">
              Somewhere for your attention <em>to rest.</em>
            </h2>
            <p className="mn-strip-note">
              A feed is context-switching on a loop; a maze, a minefield or a chess position is
              one thing at a time. Minesweeper in a 5&times;5&times;5 volume, a first-person maze,
              chess against a real Stockfish running as WebAssembly on your own machine, a runner,
              a drifting raven. Progress banks every second and the summary always wins the
              screen. No streaks, no scores kept overnight &mdash; a thing that wanted your
              attention would be the problem again, in a nicer coat.
            </p>

            <div className="mn-shot-row mn-shot-row--wide" data-reveal-group>
              <figure className="mn-shot mn-shot--framed">
                <img src="/shots/sweeper.png" alt="Minesweeper 3D: a 5×5×5 lattice pulled apart by the disperse slider" width="1600" height="863" loading="lazy" />
                <figcaption className="mn-fact">Minesweeper 3D &middot; mid-disperse</figcaption>
              </figure>
              <figure className="mn-shot mn-shot--framed">
                <img src="/shots/maze.png" alt="The maze, walked in first person through stone corridors" width="1600" height="863" loading="lazy" />
                <figcaption className="mn-fact">The maze &middot; first person</figcaption>
              </figure>
            </div>
          </article>
        </section>

        {/* ============ 4b · open source ============
            The project is small on purpose — a Rust core, a TypeScript front,
            and three seams designed to take contributions: sources, games,
            platforms. Each tile names one seam and where it lives. */}
        <section className="mn-section mn-contrib" id="contribute" data-reveal>
          <span className="mn-strip-eyebrow">
            <b>+</b>
            <i aria-hidden="true" />
            Open source
          </span>
          <h2 className="mn-strip-title">
            Yours to <em>build on.</em>
          </h2>
          <p className="mn-strip-note">
            MIT, small enough to read in an afternoon, and shaped so the interesting changes are
            easy ones. The seams below are deliberate &mdash; each is one file or one folder, with
            the door left open on purpose.
          </p>

          <div className="mn-tiles" data-reveal-group>
            <div className="mn-tile">
              <span className="mn-fact">Wire your agent</span>
              <p>
                Everything source-specific lives in one file: the normaliser. If your agent has a
                stop hook and can write JSON to stdin, it can knock. Claude Code is wired today;
                Codex is documented and waiting on someone to verify it.
              </p>
            </div>
            <div className="mn-tile">
              <span className="mn-fact">Port it</span>
              <p>
                The core is Tauri and Rust &mdash; Linux is mostly a matter of windowing and a
                notification path, Windows follows. The macOS-only code is fenced and labelled, so
                a port starts from a map rather than an archaeology dig.
              </p>
            </div>
            <div className="mn-tile">
              <span className="mn-fact">Add a game</span>
              <p>
                Games are self-contained TypeScript modules with a tiny contract: draw, pause when
                told, save a snapshot once a second. If it holds one thread of attention and lets
                go when the summary arrives, it belongs.
              </p>
            </div>
            <div className="mn-tile">
              <span className="mn-fact">Sharpen the thing itself</span>
              <p>
                The panel, the sounds, the history, the install path &mdash; all of it is open.
                The design principles are written down in the repo, so you can tell a fix from a
                regression before you send it.
              </p>
            </div>
          </div>

          <div className="mn-install-foot">
            <a className="mn-glass mn-cta" href="https://github.com/mooler-z/muninn">
              Read the source ↗
            </a>
            <span className="mn-install-note">
              CONTRIBUTING.md and ARCHITECTURE.md are where to start
            </span>
          </div>
        </section>

        {/* ============ 5 · privacy ============
            The one block that does not look like the rest of the page, for the
            one section a sceptical reader scrolls straight to. */}
        <section className="mn-section" data-reveal>
            <div className="mn-plate">
              <div className="mn-plate-head">
                <span className="mn-fact">Privacy &amp; footprint</span>
                <h2 className="mn-plate-title">Your agent&rsquo;s output stays yours.</h2>
                <p className="mn-plate-note">
                  A tool that reads every prompt you write and every reply you get is asking for a
                  lot of trust. The design answer is to make the trust unnecessary: there is no
                  account to make, nowhere for it to send anything, and no code path that opens a
                  connection.
                </p>
              </div>

              <div className="mn-plate-grid">
                <div>
                  <span className="mn-fact">Local only</span>
                  <p>
                    The payload &mdash; your working directory and your agent&rsquo;s full output
                    &mdash; is read from a hook and written to your disk. Unplug the wifi and
                    everything still works.
                  </p>
                </div>
                <div>
                  <span className="mn-fact">Locked down</span>
                  <p>
                    The receiver binds to 127.0.0.1, requires a token from a 0600-mode file, and
                    rejects anything carrying an Origin header &mdash; a web page cannot post you a
                    fake panel.
                  </p>
                </div>
                <div>
                  <span className="mn-fact">Never in the way</span>
                  <p>
                    The hook shim has zero dependencies and exits within 500&nbsp;ms whatever
                    happens. Nothing you run ever waits on Muninn.
                  </p>
                </div>
                <div>
                  <span className="mn-fact">Nothing lost, nothing idling</span>
                  <p>
                    Not running? The payload spools to disk and the panel is there at next launch.
                    Built on Tauri &mdash; a small native app, idle cost indistinguishable from zero.
                  </p>
                </div>
              </div>
            </div>
        </section>
      </div>
      </main>

      <div className="mn-wrap">
        {/* ============ 6 · the last word ============ */}
        <section className="mn-closer" data-reveal>
          <h2 className="mn-closer-title">Give the waiting somewhere to go.</h2>
          <p className="mn-closer-note">
            One command, and nothing else about your setup changes. The agent you already run keeps
            working exactly as it did &mdash; except now it tells you when it is finished, and what
            it did while you were away.
          </p>
          <CopyCommand
            command="curl -fsSL https://muninn.moolerz.et/install.sh | sh"
            className="mn-oneliner--closer"
          />
          <p className="mn-closer-fine">
            macOS &middot; nothing to install first &middot; run it again to update
          </p>
        </section>
      </div>

      <div className="mn-wrap">
        {/* ============ 7 · footer ============ */}
        <footer className="mn-footer">
          <div className="mn-myth">
            <span className="mn-logo mn-logo--foot" aria-hidden="true" />
            <div>
              <p>
                Odin keeps two ravens. Huginn and Muninn fly out over the world each day and return
                at dusk to tell him what they saw. Muninn is the one that carries memory.
              </p>
              <span className="mn-fact">Pronounced MOO-nin</span>
            </div>
          </div>
          <div className="mn-footer-links">
            <a href="https://github.com/mooler-z/muninn">Source ↗</a>
            <span>macOS · menu bar · built with Tauri</span>
            {/*
              The design read "This page has none either", which stopped being
              true the moment the page started counting visits. It counts them
              without cookies, without third parties and without ever storing an
              address — so the accurate claim is narrower than the original, and
              it is the narrower one that goes on the page.
            */}
            <span>No account. No third-party trackers, no cookies on this page.</span>
          </div>
        </footer>
      </div>
    </>
  );
}
