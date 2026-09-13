//! Process bootstrap facade.

/// Compatibility entry point for binaries while startup orchestration moves
/// out of the legacy `server::main` module.
pub async fn run() -> anyhow::Result<()> {
  crate::server::main::run_server().await
}
