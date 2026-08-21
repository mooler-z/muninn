//! Is there a network at all?
//!
//! Muninn itself never needs one — that is the whole claim. The agent does.
//! Claude Code talks to a model over the internet, so when the connection goes
//! the agent stops mid-turn and simply produces nothing, which from the other
//! side of the room is indistinguishable from it still thinking. Saying so is
//! the one piece of news Muninn can give that its own summaries cannot.
//!
//! **Nothing is sent.** Connecting a UDP socket does not put a packet on the
//! wire; it asks the kernel to pick a route and fails if there is none. That is
//! the whole test. Pinging a server would be a more direct answer and would
//! also make an app that promises to stay on your Mac start talking to a
//! stranger every few seconds.

use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::AppHandle;

/// Slow on purpose. This is weather, not telemetry: a connection that drops for
/// three seconds and comes back is not worth a window, and design principle §8
/// makes idle cost a constraint.
const EVERY: Duration = Duration::from_secs(6);

/// How long a connection has to stay down before it is worth saying anything.
///
/// A wifi handover, a VPN reconnecting, waking from sleep — all of these are
/// briefly offline and none of them stop an agent for long enough to matter.
const CONFIRM: u32 = 2;

static ONLINE: AtomicBool = AtomicBool::new(true);

/// True when the machine has a route to the internet.
///
/// Two addresses, because one of them may be blocked by a local policy while
/// the network is perfectly fine — Cloudflare and Google resolvers are rarely
/// both unroutable on a working connection.
fn reachable() -> bool {
    const PROBES: [&str; 2] = ["1.1.1.1:53", "8.8.8.8:53"];

    PROBES.iter().any(|address| {
        let Ok(socket) = UdpSocket::bind("0.0.0.0:0") else {
            return false;
        };
        // Succeeds if the kernel can choose a source address for that
        // destination, which requires a default route. No datagram is sent.
        socket.connect(address).is_ok()
    })
}

/// Watch, and say something the moment it has been down long enough to matter.
pub fn watch(app: &AppHandle) {
    let app = app.clone();

    std::thread::spawn(move || {
        // Start from the truth rather than from an assumption, so launching
        // with the wifi already off is noticed rather than treated as normal.
        ONLINE.store(reachable(), Ordering::SeqCst);
        let mut down = 0u32;

        loop {
            std::thread::sleep(EVERY);
            let now = reachable();
            let was = ONLINE.load(Ordering::SeqCst);

            if now {
                down = 0;
                if !was {
                    ONLINE.store(true, Ordering::SeqCst);
                    crate::notice::show(
                        &app,
                        "Back online",
                        "Your agent can reach its model again.",
                        false,
                    );
                }
                continue;
            }

            if was {
                down += 1;
                if down < CONFIRM {
                    continue;
                }
                ONLINE.store(false, Ordering::SeqCst);
                crate::notice::show(
                    &app,
                    "No network",
                    "Your agent cannot reach its model, so this turn will not finish.",
                    true,
                );
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probing_sends_nothing_and_answers_quickly() {
        // Whatever this machine's connection is doing, the check must return
        // rather than block — it runs on a timer for the life of the app.
        let start = std::time::Instant::now();
        let _ = reachable();
        assert!(start.elapsed() < Duration::from_millis(500));
    }
}
