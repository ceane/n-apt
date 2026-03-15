//! Simple binary entry point for N-APT backend
//!
//! This binary delegates to the main server functionality in the library.

use anyhow::Result;

#[tokio::main]
async fn main() -> Result<()> {
  // Delegate to the actual server implementation
  n_apt_backend::run_server().await
}
