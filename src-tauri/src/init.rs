//! `muninn init` — set up a project, from one command.
//!
//! The app is a menu-bar app with no window to put a setup wizard in, and the
//! three things a new user needs are all file edits: register the hooks, put
//! `MUNINN.md` in the project, point `CLAUDE.md` at it. So they live here, in
//! the same binary, reached by an argv check before Tauri ever boots.
//!
//! Two rules run through the whole module.
//!
//! **Running it twice must change nothing.** That is what lets one command be
//! both the installer and the updater: re-run it after upgrading the app and
//! `MUNINN.md` refreshes, the `CLAUDE.md` block is replaced in place, and the
//! hooks are left alone because they are already correct.
//!
//! **`CLAUDE.md` and `settings.json` belong to the user.** Muninn appends one
//! delimited block to the first and merges one key into the second. Anything
//! that reads like "rewrite the file" is a bug — someone's `settings.json` is
//! hundreds of lines of permissions they accumulated over months.

use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

/// The contract, embedded at compile time.
///
/// Not fetched, and not read from beside the binary: this way the file a user
/// gets always matches the app that wrote it, and `init` works with no network
/// and no install layout to get wrong.
const CONTRACT: &str = include_str!("../../MUNINN.md");

/// The line that makes Claude Code read the contract.
const POINTER: &str = "Read MUNINN.md and follow it. It takes priority over anything here that conflicts.";

/// Markers around Muninn's paragraph in someone else's file.
///
/// These are the whole idempotency story for `CLAUDE.md`. Without them a second
/// run appends a second copy, and there is no way to update the line later
/// without guessing which one is ours.
const BEGIN: &str = "<!-- muninn:start -->";
const END: &str = "<!-- muninn:end -->";

/// Files that mean "this is a project", so `muninn init` in `$HOME` does not
/// quietly scatter files across someone's home directory.
const MARKERS: [&str; 7] = [
    ".git",
    "CLAUDE.md",
    "package.json",
    "Cargo.toml",
    "pyproject.toml",
    "go.mod",
    "Gemfile",
];

/// Which agent events Muninn wants, and what each becomes.
///
/// `UserPromptSubmit` is the turn beginning — it arms the waiting window and is
/// never queued. The other two are summaries.
const HOOKS: [(&str, &str); 3] = [
    ("UserPromptSubmit", "started"),
    ("Stop", "completed"),
    ("Notification", "needs-input"),
];

struct Options {
    dir: PathBuf,
    dry_run: bool,
    force: bool,
    launch: bool,
}

/// The same palette as install.sh, and the same rules: only when stdout is a
/// terminal, and never when NO_COLOR is set. The installer pipes this output
/// straight to the user's tty, so the two halves read as one program.
struct Ink {
    accent: &'static str,
    dim: &'static str,
    bold: &'static str,
    red: &'static str,
    reset: &'static str,
}

fn ink() -> Ink {
    let on = std::io::stdout().is_terminal()
        && std::env::var_os("NO_COLOR").is_none()
        && std::env::var("TERM").map(|t| t != "dumb").unwrap_or(true);
    if on {
        Ink {
            accent: "[38;5;209m",
            dim: "[2m",
            bold: "[1m",
            red: "[31m",
            reset: "[0m",
        }
    } else {
        Ink { accent: "", dim: "", bold: "", red: "", reset: "" }
    }
}

/// What one step did. Printed, and used to decide the exit code.
enum Did {
    Created(String),
    Updated(String),
    Unchanged(String),
    Failed(String),
}

impl Did {
    fn line(&self, ink: &Ink) -> String {
        let Ink { accent, dim, red, reset, .. } = ink;
        match self {
            Did::Created(w) => format!("  {accent}✓ created{reset}    {w}"),
            Did::Updated(w) => format!("  {accent}✓ updated{reset}    {w}"),
            Did::Unchanged(w) => format!("  {dim}· unchanged{reset}  {w}"),
            Did::Failed(w) => format!("  {red}✗ FAILED{reset}     {w}"),
        }
    }
}

/// Handle `muninn init` if that is what was asked, and say whether it was.
///
/// Returns the exit code to use, or `None` when this is an ordinary launch and
/// the app should start normally.
pub fn intercept() -> Option<i32> {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    match argv.first().map(String::as_str) {
        Some("init") => Some(run(parse(&argv[1..]))),
        Some("--version" | "-V") => {
            println!("muninn {}", env!("CARGO_PKG_VERSION"));
            Some(0)
        }
        Some("--help" | "-h" | "help") => {
            println!("{}", usage());
            Some(0)
        }
        _ => None,
    }
}

fn usage() -> &'static str {
    "muninn — a menu-bar companion for coding agents.

USAGE
  muninn                    launch the app
  muninn init [DIR]         set this project up, and register the agent hooks
  muninn --version

INIT OPTIONS
  --dry-run    say what would change, write nothing
  --force      set up a directory that does not look like a project
  --launch     start the app afterwards

Run it again any time. It is the update path as well as the install path:
nothing changes unless something is out of date."
}

fn parse(rest: &[String]) -> Options {
    let mut options = Options {
        dir: std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
        dry_run: false,
        force: false,
        launch: false,
    };

    for arg in rest {
        match arg.as_str() {
            "--dry-run" | "-n" => options.dry_run = true,
            "--force" | "-f" => options.force = true,
            "--launch" => options.launch = true,
            other if !other.starts_with('-') => options.dir = PathBuf::from(other),
            _ => {}
        }
    }

    options.dir = options.dir.canonicalize().unwrap_or(options.dir);
    options
}

fn run(options: Options) -> i32 {
    if !options.dir.is_dir() {
        eprintln!("muninn: {} is not a directory", options.dir.display());
        return 1;
    }

    let project = MARKERS.iter().any(|m| options.dir.join(m).exists());
    if !project && !options.force {
        eprintln!(
            "muninn: {} does not look like a project.\n\
             \n\
             Nothing here matches {}. Running in the wrong directory would leave\n\
             a MUNINN.md and a CLAUDE.md somewhere you did not want them, so this\n\
             stops instead. Use --force if you meant it.",
            options.dir.display(),
            MARKERS.join(", ")
        );
        return 1;
    }

    let ink = ink();
    println!(
        "{}muninn init{}  {}{}{}",
        ink.bold,
        ink.reset,
        ink.dim,
        options.dir.display(),
        ink.reset
    );
    if options.dry_run {
        println!("             {}(dry run — nothing will be written){}", ink.dim, ink.reset);
    }
    println!();

    let steps = vec![
        write_contract(&options),
        patch_claude_md(&options),
        register_hooks(&options),
    ];

    for step in &steps {
        println!("{}", step.line(&ink));
    }

    let failed = steps.iter().any(|s| matches!(s, Did::Failed(_)));
    if failed {
        println!("\nSomething did not go through. Nothing else was rolled back —\n\
                  fix the problem above and run `muninn init` again.");
        return 1;
    }

    if options.dry_run {
        return 0;
    }

    println!(
        "\n{}Done.{} Your agent will knock when it finishes a turn.\n{}Commit MUNINN.md and the CLAUDE.md block — they describe the project,\nnot this machine, so they are useful to everyone who works on it.{}",
        ink.accent, ink.reset, ink.dim, ink.reset
    );

    if options.launch {
        launch();
    }
    0
}

/// Write `MUNINN.md`, which is Muninn's file rather than the user's.
///
/// Overwritten without ceremony when it differs, because the version embedded
/// in this binary is by definition the one this app understands. That is also
/// what makes re-running `init` the way to update the contract.
fn write_contract(options: &Options) -> Did {
    let path = options.dir.join("MUNINN.md");
    let what = "MUNINN.md".to_string();

    let existing = std::fs::read_to_string(&path).ok();
    if existing.as_deref() == Some(CONTRACT) {
        return Did::Unchanged(what);
    }

    if options.dry_run {
        return match existing {
            Some(_) => Did::Updated(what),
            None => Did::Created(what),
        };
    }

    match std::fs::write(&path, CONTRACT) {
        Ok(()) if existing.is_some() => Did::Updated(what),
        Ok(()) => Did::Created(what),
        Err(e) => Did::Failed(format!("MUNINN.md — {e}")),
    }
}

/// Add the pointer to `CLAUDE.md`, inside markers, without disturbing the rest.
///
/// Appended rather than prepended. Claude Code reads the whole file, so putting
/// it first buys nothing and rewrites the opening of a document somebody else
/// wrote.
fn patch_claude_md(options: &Options) -> Did {
    let path = options.dir.join("CLAUDE.md");
    let what = "CLAUDE.md".to_string();
    let block = format!("{BEGIN}\n{POINTER}\n{END}\n");

    let Some(existing) = std::fs::read_to_string(&path).ok() else {
        if options.dry_run {
            return Did::Created(what);
        }
        return match std::fs::write(&path, &block) {
            Ok(()) => Did::Created(what),
            Err(e) => Did::Failed(format!("CLAUDE.md — {e}")),
        };
    };

    let updated = match replace_block(&existing, &block) {
        Some(next) => next,
        // No markers. Someone may still have written the pointer by hand, in
        // which case saying it twice is worse than not managing it at all.
        None if existing.contains("MUNINN.md") => return Did::Unchanged(what),
        None => {
            let mut next = existing.clone();
            if !next.ends_with('\n') {
                next.push('\n');
            }
            next.push('\n');
            next.push_str(&block);
            next
        }
    };

    if updated == existing {
        return Did::Unchanged(what);
    }
    if options.dry_run {
        return Did::Updated(what);
    }
    match std::fs::write(&path, updated) {
        Ok(()) => Did::Updated(what),
        Err(e) => Did::Failed(format!("CLAUDE.md — {e}")),
    }
}

/// Swap the contents of an existing managed block, keeping everything around it.
fn replace_block(text: &str, block: &str) -> Option<String> {
    let start = text.find(BEGIN)?;
    let end = text[start..].find(END).map(|i| start + i + END.len())?;
    let mut out = String::with_capacity(text.len() + block.len());
    out.push_str(&text[..start]);
    out.push_str(block.trim_end_matches('\n'));
    out.push_str(&text[end..]);
    Some(out)
}

/// Merge Muninn's hooks into `~/.claude/settings.json`.
///
/// The hooks describe *this machine has Muninn*, so they are global rather than
/// committed to a repo — a teammate without the app should not inherit a hook
/// pointing at a binary they do not have.
fn register_hooks(options: &Options) -> Did {
    let what = "~/.claude/settings.json".to_string();

    let Some(shim) = shim_path() else {
        return Did::Failed(format!(
            "{what} — cannot find muninn-forward next to this binary"
        ));
    };

    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return Did::Failed(format!("{what} — no HOME"));
    };
    let dir = home.join(".claude");
    let path = dir.join("settings.json");

    let existing = std::fs::read_to_string(&path).ok();
    let mut settings: Value = match existing.as_deref() {
        Some(text) => match serde_json::from_str(text) {
            Ok(v) => v,
            // Refusing is the only safe answer. Replacing a settings file we
            // could not parse would throw away whatever is actually in it.
            Err(e) => {
                return Did::Failed(format!("{what} — could not parse it ({e}); left alone"))
            }
        },
        None => json!({}),
    };

    if !settings.is_object() {
        return Did::Failed(format!("{what} — is not a JSON object; left alone"));
    }

    let before = settings.clone();
    for (event, kind) in HOOKS {
        add_hook(&mut settings, event, &command_for(&shim, kind));
    }

    if settings == before {
        return Did::Unchanged(what);
    }
    if options.dry_run {
        return match existing {
            Some(_) => Did::Updated(what),
            None => Did::Created(what),
        };
    }

    if let Err(e) = std::fs::create_dir_all(&dir) {
        return Did::Failed(format!("{what} — {e}"));
    }
    match write_atomically(&path, &settings) {
        Ok(()) if existing.is_some() => Did::Updated(what),
        Ok(()) => Did::Created(what),
        Err(e) => Did::Failed(format!("{what} — {e}")),
    }
}

fn command_for(shim: &Path, kind: &str) -> String {
    format!("{} --source claude-code --kind {kind}", shim.display())
}

/// Add one hook entry, leaving every other hook exactly as it was.
///
/// Claude Code's shape is `hooks.<Event>[].hooks[]`, where the outer array is
/// matcher groups. Muninn adds its command to a group with an empty matcher,
/// creating one only if there is not already such a group to join.
fn add_hook(settings: &mut Value, event: &str, command: &str) {
    let groups = settings
        .as_object_mut()
        .expect("checked before call")
        .entry("hooks")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .map(|h| h.entry(event).or_insert_with(|| json!([])));

    let Some(groups) = groups else { return };
    let Some(groups) = groups.as_array_mut() else { return };

    // Already ours, possibly from an older install path. Rewrite it rather
    // than adding a second: the path may have changed.
    for group in groups.iter_mut() {
        let Some(entries) = group.get_mut("hooks").and_then(Value::as_array_mut) else {
            continue;
        };
        for entry in entries.iter_mut() {
            let is_ours = entry
                .get("command")
                .and_then(Value::as_str)
                .is_some_and(is_muninn_command);
            if is_ours {
                entry["command"] = json!(command);
                entry["type"] = json!("command");
                return;
            }
        }
    }

    groups.push(json!({
        "matcher": "",
        "hooks": [{ "type": "command", "command": command }]
    }));
}

/// Whether a configured command is one of ours.
///
/// Matched on the binary name rather than the full path, so moving the app or
/// upgrading it repoints the existing entry instead of leaving a dead one
/// beside a live one.
fn is_muninn_command(command: &str) -> bool {
    command.contains("muninn-forward")
}

/// Write via a temporary file and rename.
///
/// `settings.json` is the file Claude Code reads at startup and this is the
/// user's accumulated configuration. A half-written one is a broken install;
/// rename is atomic within a filesystem, so the file is either the old one or
/// the new one and never a truncated mix.
fn write_atomically(path: &Path, value: &Value) -> std::io::Result<()> {
    let text = serde_json::to_string_pretty(value)?;
    let temp = path.with_extension("json.muninn-tmp");
    {
        let mut file = std::fs::File::create(&temp)?;
        file.write_all(text.as_bytes())?;
        file.write_all(b"\n")?;
        file.sync_all()?;
    }
    std::fs::rename(&temp, path)
}

/// Where the shim is, given where this binary is.
///
/// Tauri stages an `externalBin` beside the app's own executable inside
/// `Contents/MacOS/`, suffixed with the target triple on disk during
/// development. Both layouts are checked so `init` works from a built bundle
/// and from `cargo run` alike.
fn shim_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;

    let candidates = [
        dir.join("muninn-forward"),
        dir.join(format!("muninn-forward-{}", std::env::consts::ARCH)),
        // `cargo run` from the workspace: both binaries land side by side.
        dir.join("../../target/release/muninn-forward"),
    ];

    candidates
        .into_iter()
        .find(|p| p.is_file())
        .and_then(|p| p.canonicalize().ok())
}

fn launch() {
    // The bundle, not this executable: launching the inner binary directly
    // gives an app with no bundle identity — no icon, no menu bar item.
    let Ok(exe) = std::env::current_exe() else { return };
    let bundle = exe.ancestors().find(|p| p.extension().is_some_and(|e| e == "app"));
    let target = bundle.map(Path::to_path_buf).unwrap_or(exe);
    let _ = std::process::Command::new("open").arg(target).spawn();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block() -> String {
        format!("{BEGIN}\n{POINTER}\n{END}\n")
    }

    #[test]
    fn the_embedded_contract_is_the_real_one() {
        assert!(CONTRACT.contains("```muninn"), "the block format must survive");
        assert!(CONTRACT.contains("explain"), "the long summary must survive");
    }

    #[test]
    fn a_managed_block_is_replaced_rather_than_repeated() {
        let before = format!("# My rules\n\nBe nice.\n\n{}", block());
        let after = replace_block(&before, &block()).unwrap();
        assert_eq!(after.matches(BEGIN).count(), 1);
        assert!(after.starts_with("# My rules"), "their content is untouched");
    }

    #[test]
    fn an_edited_block_is_brought_back_up_to_date() {
        let stale = format!("{BEGIN}\nsomething older\n{END}\n");
        let after = replace_block(&stale, &block()).unwrap();
        assert!(after.contains(POINTER));
        assert!(!after.contains("something older"));
    }

    #[test]
    fn text_around_the_block_survives_on_both_sides() {
        let before = format!("top\n\n{}\nbottom\n", block());
        let after = replace_block(&before, &block()).unwrap();
        assert!(after.starts_with("top"));
        assert!(after.trim_end().ends_with("bottom"));
    }

    #[test]
    fn a_file_without_markers_is_not_a_block() {
        assert!(replace_block("# Rules\n\nnothing of ours here\n", &block()).is_none());
    }

    #[test]
    fn hooks_are_added_without_touching_what_is_there() {
        let mut settings = json!({
            "permissions": { "allow": ["Bash(ls)"] },
            "model": "opus",
        });
        add_hook(&mut settings, "Stop", "/Applications/Muninn.app/muninn-forward --kind completed");

        assert_eq!(settings["permissions"]["allow"][0], "Bash(ls)");
        assert_eq!(settings["model"], "opus");
        assert_eq!(settings["hooks"]["Stop"][0]["hooks"][0]["type"], "command");
    }

    #[test]
    fn someone_elses_hook_on_the_same_event_is_left_alone() {
        let mut settings = json!({
            "hooks": {
                "Stop": [{
                    "matcher": "",
                    "hooks": [{ "type": "command", "command": "/usr/local/bin/my-own-thing" }]
                }]
            }
        });
        add_hook(&mut settings, "Stop", "/Applications/Muninn.app/muninn-forward --kind completed");

        let groups = settings["hooks"]["Stop"].as_array().unwrap();
        let survivors: Vec<_> = groups
            .iter()
            .flat_map(|g| g["hooks"].as_array().unwrap())
            .map(|h| h["command"].as_str().unwrap())
            .collect();
        assert!(survivors.iter().any(|c| c.contains("my-own-thing")));
        assert!(survivors.iter().any(|c| c.contains("muninn-forward")));
    }

    #[test]
    fn running_twice_adds_one_hook_not_two() {
        let mut settings = json!({});
        let command = "/Applications/Muninn.app/muninn-forward --kind completed";
        add_hook(&mut settings, "Stop", command);
        add_hook(&mut settings, "Stop", command);

        let count: usize = settings["hooks"]["Stop"]
            .as_array()
            .unwrap()
            .iter()
            .map(|g| g["hooks"].as_array().unwrap().len())
            .sum();
        assert_eq!(count, 1, "idempotent, or the agent fires the hook twice");
    }

    #[test]
    fn moving_the_app_repoints_the_existing_hook() {
        let mut settings = json!({});
        add_hook(&mut settings, "Stop", "/old/place/muninn-forward --kind completed");
        add_hook(&mut settings, "Stop", "/new/place/muninn-forward --kind completed");

        let groups = settings["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(groups.len(), 1, "repointed, not duplicated");
        let command = groups[0]["hooks"][0]["command"].as_str().unwrap();
        assert!(command.starts_with("/new/place"), "and it is the new path");
    }

    #[test]
    fn every_event_muninn_needs_gets_registered() {
        let mut settings = json!({});
        for (event, kind) in HOOKS {
            add_hook(&mut settings, event, &format!("/x/muninn-forward --kind {kind}"));
        }
        for (event, _) in HOOKS {
            assert!(settings["hooks"][event].is_array(), "{event} is missing");
        }
    }

    #[test]
    fn key_order_survives_a_round_trip() {
        // `preserve_order` is on for exactly this reason: adding one key must
        // not reshuffle a config file someone spent months accumulating.
        let text = r#"{"permissions":{},"model":"opus","theme":"dark"}"#;
        let mut settings: Value = serde_json::from_str(text).unwrap();
        add_hook(&mut settings, "Stop", "/x/muninn-forward --kind completed");
        let out = serde_json::to_string(&settings).unwrap();
        let permissions = out.find("permissions").unwrap();
        let model = out.find(r#""model""#).unwrap();
        let theme = out.find("theme").unwrap();
        assert!(permissions < model && model < theme, "got: {out}");
    }
}
