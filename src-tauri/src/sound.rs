//! The sound.
//!
//! Design principle §1 calls this the product's first impression and the
//! easiest thing to get wrong, so the rules are worth restating where the code
//! lives: soft attack, short, quiet by default, no rising alarm shapes, no
//! escalation. If the user mutes it, the tool is useless — so the bar is that
//! nobody ever wants to.
//!
//! It sounds three times, at the owner's request. That is a departure from
//! §1's "no repeats", made deliberately: a single short tone is easy to miss
//! from another room, which is exactly the situation this product is for.
//!
//! What keeps it from becoming the thing §1 rules out is that every hit is
//! identical — same sound, same volume, evenly spaced. It reads as one
//! notification with three beats, not as an alarm growing more insistent.
//! Nothing here escalates, and the assert below is what stops it starting to.

use muninn_core::Kind;

use crate::settings::Settings;

/// System sounds, chosen for character rather than convenience.
///
/// `Tink` is the shape design principle §1 names as roughly the target: a short
/// soft attack with no tail. `Purr` is softer still and lands lower, which is
/// what "a different, *quieter* sound for needs-input" asks for — being asked a
/// question is less final than being finished.
const COMPLETED: &str = "/System/Library/Sounds/Tink.aiff";
const NEEDS_INPUT: &str = "/System/Library/Sounds/Purr.aiff";

/// Quiet by default, and quieter still for the lesser event. `afplay` takes a
/// linear multiplier, so these are well below the system volume rather than at
/// it.
const VOLUME_COMPLETED: f32 = 0.35;
const VOLUME_NEEDS_INPUT: f32 = 0.22;

/// The gap between the two hits.
///
/// Long enough to be two beats rather than a flam, short enough to still be
/// one event. `Tink` is about 350ms of tail, so this lands after it rather
/// than on top of it.
const AGAIN_AFTER: std::time::Duration = std::time::Duration::from_millis(520);

/// How many times. Three, at the owner's request, and every hit identical to
/// the first — see the note at the top of this file.
const HITS: usize = 3;

// Design principle §1, enforced at compile time rather than merely tested.
// Being asked a question is less final than being finished and must not arrive
// louder, and neither may creep up towards the system volume.
const _: () = {
    assert!(VOLUME_NEEDS_INPUT < VOLUME_COMPLETED);
    assert!(VOLUME_COMPLETED <= 0.5);
    // A ceiling, not a target. Beyond three, evenly spaced or not, it stops
    // being a notification and becomes the alarm §1 exists to rule out.
    assert!(HITS <= 3);
};

pub fn play(kind: Kind, settings: &Settings) {
    if !should_play(kind, settings, local_hour()) {
        return;
    }

    let (path, volume) = match kind {
        Kind::NeedsInput => (NEEDS_INPUT, VOLUME_NEEDS_INPUT),
        Kind::Completed | Kind::Failed => (COMPLETED, VOLUME_COMPLETED),
    };

    if !std::path::Path::new(path).exists() {
        return;
    }

    // Off this thread: the second hit waits half a second, and nothing about
    // delivering a summary should wait with it.
    std::thread::spawn(move || {
        for hit in 0..HITS {
            if hit > 0 {
                std::thread::sleep(AGAIN_AFTER);
            }
            // Spawned and forgotten. A CoreAudio handle held open all day to
            // save a process spawn six times a day is the wrong side of design
            // principle §8.
            let _ = std::process::Command::new("/usr/bin/afplay")
                .arg("-v")
                .arg(volume.to_string())
                .arg(path)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn();
        }
    });
}

/// Split out from [`play`] so the policy is testable without making noise.
fn should_play(_kind: Kind, settings: &Settings, hour: u8) -> bool {
    if settings.muted {
        return false;
    }
    if settings.silent_hours.covers(hour) {
        return false;
    }
    true
}

fn local_hour() -> u8 {
    time::OffsetDateTime::now_local()
        .unwrap_or_else(|_| time::OffsetDateTime::now_utc())
        .hour()
}

// NOTE: Do Not Disturb and Focus are not consulted, and design principle §1
// asks for it ("if the user is on a call or screen-sharing, suppress the sound
// and keep the panel for later"). Every route to that state is either private
// API or a plist whose shape has changed between macOS releases, so reading it
// wrong would mean silently swallowing sounds — worse than not trying. Left
// undone deliberately rather than shipped fragile.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::SilentHours;

    fn settings() -> Settings {
        Settings::default()
    }

    #[test]
    fn plays_during_the_working_day() {
        assert!(should_play(Kind::Completed, &settings(), 14));
    }

    #[test]
    fn mute_wins_over_everything() {
        let s = Settings { muted: true, ..settings() };
        assert!(!should_play(Kind::Completed, &s, 14));
        assert!(!should_play(Kind::NeedsInput, &s, 14));
    }

    #[test]
    fn silent_hours_hold_the_panel_but_not_the_sound() {
        // The panel still appears; only the sound is suppressed. This test
        // guards the sound half.
        assert!(!should_play(Kind::Completed, &settings(), 23));
        assert!(!should_play(Kind::Completed, &settings(), 3));
    }

    #[test]
    fn turning_silent_hours_off_restores_the_night() {
        let s = Settings {
            silent_hours: SilentHours { enabled: false, ..Default::default() },
            ..settings()
        };
        assert!(should_play(Kind::Completed, &s, 23));
    }

    #[test]
    fn needs_input_gets_its_own_sound() {
        // Design principle §1 asks for a different, quieter sound. The volumes
        // are guarded by a const assertion above; this is the "different" half.
        assert_ne!(COMPLETED, NEEDS_INPUT);
    }
}
