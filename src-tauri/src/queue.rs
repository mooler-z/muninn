//! One window, ever.
//!
//! Design principle §7: two agents finishing together must not stack two
//! windows. They queue, the panel shows a count, and the user pages through.
//! A pile of windows is the exact anxiety this tool exists to remove.

use std::collections::VecDeque;

use muninn_core::MuninnEvent;
use serde::Serialize;

/// "Kept on this Mac · last 50 turns", as the design's history window says.
const HISTORY_LIMIT: usize = 50;

#[derive(Default)]
pub struct Queue {
    pending: Vec<MuninnEvent>,
    index: usize,
    history: VecDeque<MuninnEvent>,
}

/// What the panel needs in order to render itself, including its place in the
/// queue. Sent as one payload so the window never renders a half-updated state.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub event: MuninnEvent,
    /// 1-based, for the design's `‹ 2 of 3 ›` pager.
    pub position: usize,
    pub total: usize,
    /// Markdown-rendered `raw`, for the fallback path. Rendered app-side so the
    /// webview never has to parse untrusted text — see `markdown.rs`.
    pub raw_html: String,
    /// Markdown-rendered `explain`. Same path, same reason.
    pub explain_html: String,
}

impl Queue {
    /// Add an event and make it the one on screen.
    ///
    /// The newest is shown rather than the oldest: someone returning to their
    /// desk wants the current state of the world, and the pager is right there
    /// for the ones they missed.
    pub fn push(&mut self, event: MuninnEvent) {
        self.history.push_front(event.clone());
        self.history.truncate(HISTORY_LIMIT);
        self.pending.push(event);
        self.index = self.pending.len() - 1;
    }

    pub fn current(&self) -> Option<View> {
        let event = self.pending.get(self.index)?;
        Some(View {
            event: event.clone(),
            position: self.index + 1,
            total: self.pending.len(),
            raw_html: crate::markdown::render(&event.raw),
            explain_html: event
                .summary
                .as_ref()
                .and_then(|s| s.explain.as_deref())
                .map(crate::markdown::render)
                .unwrap_or_default(),
        })
    }

    /// Step the pager. Stops at the ends rather than wrapping — wrapping makes
    /// it impossible to tell whether you have seen everything.
    pub fn step(&mut self, delta: isize) -> Option<View> {
        if self.pending.is_empty() {
            return None;
        }
        let last = self.pending.len() - 1;
        self.index = (self.index as isize + delta).clamp(0, last as isize) as usize;
        self.current()
    }

    /// `Esc` dismisses all of them. The design's footer says as much when there
    /// is more than one: paging through a queue of six to clear it would be a
    /// chore, and this is a tool for people who stepped away.
    pub fn dismiss_all(&mut self) {
        self.pending.clear();
        self.index = 0;
    }

    pub fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }

    pub fn history(&self) -> Vec<MuninnEvent> {
        self.history.iter().cloned().collect()
    }

    /// A view of any past event, for browsing history.
    ///
    /// The position and total are those of a single item: a summary reached
    /// from the history list is not part of the pending queue, and showing it
    /// as "2 of 3" would be claiming something untrue about it.
    pub fn view_of(&self, id: &str) -> Option<View> {
        let event = self.history.iter().find(|e| e.id == id)?;
        Some(View {
            event: event.clone(),
            position: 1,
            total: 1,
            raw_html: crate::markdown::render(&event.raw),
            explain_html: event
                .summary
                .as_ref()
                .and_then(|s| s.explain.as_deref())
                .map(crate::markdown::render)
                .unwrap_or_default(),
        })
    }

    pub fn latest(&self) -> Option<&MuninnEvent> {
        self.history.front()
    }

    /// Attach the question that began a turn, once it has been recovered.
    ///
    /// Returns whether anything changed, so the caller can skip rewriting the
    /// history file for a prompt that was already there.
    pub fn remember_prompt(&mut self, id: &str, prompt: String) -> bool {
        // Both copies. An event lives in `pending` while it is on screen and
        // in `history` forever after, and updating only one of them means the
        // panel and the history window disagree about what was asked.
        let mut changed = false;
        for event in self.pending.iter_mut().chain(self.history.iter_mut()) {
            if event.id != id || event.prompt.as_deref() == Some(prompt.as_str()) {
                continue;
            }
            event.prompt = Some(prompt.clone());
            changed = true;
        }
        changed
    }

    pub fn restore_history(&mut self, events: Vec<MuninnEvent>) {
        self.history = events.into_iter().take(HISTORY_LIMIT).collect();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use muninn_core::{Kind, Source};
    use time::OffsetDateTime;

    fn event(name: &str) -> MuninnEvent {
        MuninnEvent::from_message(
            name.into(),
            Source::ClaudeCode,
            Kind::Completed,
            OffsetDateTime::now_utc(),
            &format!("```muninn\ndone: {name}\n```"),
        )
    }

    #[test]
    fn a_single_event_is_not_a_pager() {
        let mut q = Queue::default();
        q.push(event("one"));
        let view = q.current().unwrap();
        assert_eq!((view.position, view.total), (1, 1));
    }

    #[test]
    fn three_finishing_together_make_one_panel_with_a_count() {
        let mut q = Queue::default();
        for name in ["one", "two", "three"] {
            q.push(event(name));
        }
        let view = q.current().unwrap();
        assert_eq!(view.total, 3);
        // Newest on top: the user wants where things stand now.
        assert_eq!(view.event.id, "three");
        assert_eq!(view.position, 3);
    }

    #[test]
    fn paging_stops_at_the_ends_rather_than_wrapping() {
        // Wrapping would make it impossible to know you had seen everything.
        let mut q = Queue::default();
        for name in ["one", "two"] {
            q.push(event(name));
        }
        assert_eq!(q.step(-1).unwrap().position, 1);
        assert_eq!(q.step(-1).unwrap().position, 1, "should not wrap to the end");
        assert_eq!(q.step(1).unwrap().position, 2);
        assert_eq!(q.step(1).unwrap().position, 2, "should not wrap to the start");
    }

    #[test]
    fn dismissing_clears_the_queue_but_keeps_the_history() {
        let mut q = Queue::default();
        q.push(event("one"));
        q.push(event("two"));
        q.dismiss_all();

        assert!(q.is_empty());
        assert!(q.current().is_none());
        assert_eq!(q.history().len(), 2, "history outlives the panel");
        assert_eq!(q.latest().unwrap().id, "two");
    }

    #[test]
    fn history_is_capped() {
        let mut q = Queue::default();
        for i in 0..HISTORY_LIMIT + 25 {
            q.push(event(&i.to_string()));
        }
        assert_eq!(q.history().len(), HISTORY_LIMIT);
        assert_eq!(q.latest().unwrap().id, (HISTORY_LIMIT + 24).to_string());
    }

    #[test]
    fn stepping_an_empty_queue_is_not_a_panic() {
        assert!(Queue::default().step(1).is_none());
    }
}
