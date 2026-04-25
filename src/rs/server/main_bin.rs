//! Simple binary entry point for N-APT backend
//!
//! This binary delegates to the main server functionality in the library.

use anyhow::Result;

fn load_dev_env() {
  let cwd = std::env::current_dir()
    .ok()
    .and_then(|path| path.into_os_string().into_string().ok())
    .unwrap_or_else(|| "<unknown>".to_string());
  log::info!("Backend startup working directory: {}", cwd);

  let env_candidates = [".env.local", ".env"];
  let mut loaded_any = false;
  for candidate in env_candidates {
    match dotenvy::from_filename(candidate) {
      Ok(_) => {
        log::info!("Loaded environment variables from {}", candidate);
        loaded_any = true;
        break;
      }
      Err(dotenvy::Error::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
        log::info!("Environment file not found at {}", candidate);
      }
      Err(error) => {
        log::warn!("Failed to load environment file {}: {}", candidate, error);
      }
    }
  }

  if loaded_any {
    log::info!("Finished loading backend development environment variables");
  } else {
    log::warn!(
      "No .env.local or .env file was loaded; falling back to process environment"
    );
  }
}

#[tokio::main]
async fn main() -> Result<()> {
  // Check for --validate-config flag (no server startup)
  if std::env::args().any(|arg| arg == "--validate-config") {
    return validate_config();
  }

  load_dev_env();

  // Delegate to the actual server implementation
  n_apt_backend::run_server().await
}

fn validate_config() -> Result<()> {
  // Load and parse signals.yaml without starting the server
  match n_apt_backend::server::utils::signals_config() {
    config => {
      // Force evaluation by checking channels
      let ch_count = config.signals.mock_apt.channels.len();
      let n_apt_count = config.signals.n_apt.channels.len();
      println!(
        "✅ signals.yaml is valid (mock_apt channels: {}, n_apt channels: {})",
        ch_count, n_apt_count
      );
      Ok(())
    }
  }
}
