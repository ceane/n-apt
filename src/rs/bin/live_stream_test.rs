//! Live Stream Test Binary
//!
//! Standalone test application for connecting to n-apt WebSocket API
//! and receiving live FFT spectrum data and raw I/Q samples for algorithm testing.

use anyhow::Result;
use clap::{Arg, Command};
use log::{error, info, LevelFilter};

use n_apt_backend::live_stream_test::LiveStreamTester;

fn default_passkey() -> String {
  std::env::var("UNSAFE_LOCAL_USER_PASSWORD")
    .or_else(|_| std::env::var("N_APT_PASSKEY"))
    .unwrap_or_default()
}

fn default_passkey_ref() -> &'static str {
  Box::leak(default_passkey().into_boxed_str())
}

#[tokio::main]
async fn main() -> Result<()> {
  // Parse command line arguments
  let matches = Command::new("live_stream_test")
        .version("1.0.0")
        .about("Live stream test client for n-apt SDR data\n\nNOTE: Requires n-apt server to be running first (npm run dev)")
        .arg(
            Arg::new("server")
                .short('s')
                .long("server")
                .value_name("URL")
                .help("WebSocket server URL (must have n-apt server running)")
                .default_value("localhost:8765")
        )
        .arg(
            Arg::new("passkey")
                .short('p')
                .long("passkey")
                .value_name("PASSWORD")
                .help("Authentication password")
                .default_value(default_passkey_ref())
        )
        .arg(
            Arg::new("verbose")
                .short('v')
                .long("verbose")
                .help("Enable verbose logging")
                .action(clap::ArgAction::SetTrue)
        )
        .get_matches();

  // Initialize logging
  let log_level = if matches.get_flag("verbose") {
    LevelFilter::Debug
  } else {
    LevelFilter::Info
  };

  env_logger::Builder::from_default_env()
    .filter_level(log_level)
    .init();

  // Get configuration
  let server_url = matches.get_one::<String>("server").unwrap();
  let passkey = matches.get_one::<String>("passkey").unwrap();

  println!("🚀 n-apt Live Stream Test Client");
  println!("📡 Server: {}", server_url);
  println!("🔐 Passkey: {}", "*".repeat(passkey.len()));
  println!("{}", "─".to_string().repeat(50));

  // Create and run the live stream tester
  let mut tester = LiveStreamTester::new(server_url, passkey)?;

  // Run example algorithms
  tester.run_examples();

  // Set up Ctrl+C handler
  let (tx, rx) = tokio::sync::oneshot::channel::<()>();
  tokio::spawn(async move {
    #[cfg(unix)]
    {
      use tokio::signal::unix;
      let mut sigint = unix::signal(unix::SignalKind::interrupt()).unwrap();
      let mut sigterm = unix::signal(unix::SignalKind::terminate()).unwrap();

      tokio::select! {
          _ = sigint.recv() => {
              info!("Received SIGINT (Ctrl+C)");
          }
          _ = sigterm.recv() => {
              info!("Received SIGTERM");
          }
      }
    }

    #[cfg(windows)]
    {
      use tokio::signal;
      signal::ctrl_c()
        .await
        .expect("Failed to install Ctrl+C handler");
      info!("Received Ctrl+C");
    }

    let _ = tx.send(());
  });

  // Start the live stream testing
  let stream_task = tokio::spawn(async move {
    if let Err(e) = tester.start().await {
      error!("Stream error: {}", e);
    }
  });

  // Wait for shutdown signal
  tokio::select! {
      _ = rx => {
          info!("🛑 Shutting down...");
      }
      _ = stream_task => {
          info!("📡 Stream task completed");
      }
  }

  println!("👋 Live stream test completed");
  Ok(())
}
