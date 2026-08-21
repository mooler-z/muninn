//! Shared guts: where things live on disk, what a Muninn event is, and how the
//! summary contract is parsed.
//!
//! Split by dependency weight rather than by topic. [`paths`] compiles with
//! nothing but `std` so the shim can link it; everything else sits behind the
//! `model` feature.

pub mod paths;
pub mod summary;

#[cfg(feature = "model")]
pub mod event;

#[cfg(feature = "model")]
pub use event::{Kind, MuninnEvent, Source};
pub use summary::{parse, Body, Changed, Summary};
