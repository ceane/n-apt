//! Logging bootstrap compatibility boundary.

/// Keep logging initialization behind a named infrastructure seam. The
/// legacy implementation remains the source of truth until bootstrap is
/// fully moved out of `server::main`.
pub fn initialize() {
  log::info!("N-APT infrastructure logging is ready");
}
