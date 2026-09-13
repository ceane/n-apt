use std::fs::{create_dir_all, OpenOptions};
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TxPhase {
  Start,
  Change,
  End,
}

impl TxPhase {
  fn as_str(self) -> &'static str {
    match self {
      TxPhase::Start => "start",
      TxPhase::Change => "change",
      TxPhase::End => "end",
    }
  }
}

#[derive(Debug, Clone)]
pub struct TxLogEntry {
  pub phase: TxPhase,
  pub device: String,
  pub serial_number: String,
  pub transmit: bool,
  pub center_frequency_hz: Option<u64>,
  pub sample_rate_hz: Option<u64>,
  pub power_dbm: Option<f64>,
  pub lna_gain_db: Option<f64>,
  pub vga_gain_db: Option<f64>,
  pub amp_enabled: Option<bool>,
  pub tuner_agc: Option<bool>,
  pub rtl_agc: Option<bool>,
  pub ppm: Option<u32>,
}

impl TxLogEntry {
  pub fn start(
    device: String,
    serial_number: String,
    center_frequency_hz: Option<u64>,
    sample_rate_hz: Option<u64>,
    power_dbm: Option<f64>,
    lna_gain_db: Option<f64>,
    vga_gain_db: Option<f64>,
    amp_enabled: Option<bool>,
    tuner_agc: Option<bool>,
    rtl_agc: Option<bool>,
    ppm: Option<u32>,
  ) -> Self {
    Self {
      phase: TxPhase::Start,
      device,
      serial_number,
      transmit: true,
      center_frequency_hz,
      sample_rate_hz,
      power_dbm,
      lna_gain_db,
      vga_gain_db,
      amp_enabled,
      tuner_agc,
      rtl_agc,
      ppm,
    }
  }

  pub fn change(&self) -> Self {
    Self {
      phase: TxPhase::Change,
      transmit: self.transmit,
      device: self.device.clone(),
      serial_number: self.serial_number.clone(),
      center_frequency_hz: self.center_frequency_hz,
      sample_rate_hz: self.sample_rate_hz,
      power_dbm: self.power_dbm,
      lna_gain_db: self.lna_gain_db,
      vga_gain_db: self.vga_gain_db,
      amp_enabled: self.amp_enabled,
      tuner_agc: self.tuner_agc,
      rtl_agc: self.rtl_agc,
      ppm: self.ppm,
    }
  }

  pub fn end(&self) -> Self {
    Self {
      phase: TxPhase::End,
      transmit: false,
      device: self.device.clone(),
      serial_number: self.serial_number.clone(),
      center_frequency_hz: self.center_frequency_hz,
      sample_rate_hz: self.sample_rate_hz,
      power_dbm: self.power_dbm,
      lna_gain_db: self.lna_gain_db,
      vga_gain_db: self.vga_gain_db,
      amp_enabled: self.amp_enabled,
      tuner_agc: self.tuner_agc,
      rtl_agc: self.rtl_agc,
      ppm: self.ppm,
    }
  }

  pub fn with_device(
    mut self,
    device: String,
    serial_number: String,
    center_frequency_hz: Option<u64>,
    sample_rate_hz: Option<u64>,
    power_dbm: Option<f64>,
    lna_gain_db: Option<f64>,
    vga_gain_db: Option<f64>,
    amp_enabled: Option<bool>,
    tuner_agc: Option<bool>,
    rtl_agc: Option<bool>,
    ppm: Option<u32>,
  ) -> Self {
    self.device = device;
    self.serial_number = serial_number;
    self.center_frequency_hz = center_frequency_hz;
    self.sample_rate_hz = sample_rate_hz;
    self.power_dbm = power_dbm;
    self.lna_gain_db = lna_gain_db;
    self.vga_gain_db = vga_gain_db;
    self.amp_enabled = amp_enabled;
    self.tuner_agc = tuner_agc;
    self.rtl_agc = rtl_agc;
    self.ppm = ppm;
    self
  }

  fn serialize(&self, timestamp_ms: u128) -> String {
    let mut parts = vec![
      format!("timestamp_ms={}", timestamp_ms),
      format!("phase={}", self.phase.as_str()),
      format!("device={}", self.device),
      format!("serial_number={}", self.serial_number),
      format!("transmit={}", self.transmit),
    ];
    if let Some(v) = self.center_frequency_hz {
      parts.push(format!("center_frequency_hz={}", v));
    }
    if let Some(v) = self.sample_rate_hz {
      parts.push(format!("sample_rate_hz={}", v));
    }
    if let Some(v) = self.power_dbm {
      parts.push(format!("power_dbm={}", v));
    }
    if let Some(v) = self.lna_gain_db {
      parts.push(format!("lna_gain_db={}", v));
    }
    if let Some(v) = self.vga_gain_db {
      parts.push(format!("vga_gain_db={}", v));
    }
    if let Some(v) = self.amp_enabled {
      parts.push(format!("amp_enabled={}", v));
    }
    if let Some(v) = self.tuner_agc {
      parts.push(format!("tuner_agc={}", v));
    }
    if let Some(v) = self.rtl_agc {
      parts.push(format!("rtl_agc={}", v));
    }
    if let Some(v) = self.ppm {
      parts.push(format!("ppm={}", v));
    }
    parts.join(" ")
  }
}

/// Maximum lines before rotation truncates to `ROTATION_KEEP_LINES`.
const ROTATION_MAX_LINES: usize = 10_000;
/// Lines retained after rotation (tail).
const ROTATION_KEEP_LINES: usize = 5_000;
/// Minimum interval between disk writes to avoid hot-path I/O flooding.
const MIN_WRITE_INTERVAL_MS: u64 = 50;

struct TxLogInner {
  writer: BufWriter<std::fs::File>,
  line_count: usize,
  last_write: Instant,
}

pub struct TxLogger {
  inner: Mutex<TxLogInner>,
  path: PathBuf,
}

static TX_LOGGER: OnceLock<TxLogger> = OnceLock::new();

pub fn global_tx_logger() -> Option<&'static TxLogger> {
  if TX_LOGGER.get().is_none() {
    if let Ok(logger) = TxLogger::new() {
      let _ = TX_LOGGER.set(logger);
    }
  }
  TX_LOGGER.get()
}

pub fn write_global(_entry: &TxLogEntry) {
  // if let Some(logger) = global_tx_logger() {
  //   let _ = logger.write_entry(entry);
  // }
}

impl TxLogger {
  pub fn new() -> io::Result<Self> {
    Self::with_path("/tmp/n-apt/tx_log.txt")
  }

  pub fn with_path<P: AsRef<Path>>(path: P) -> io::Result<Self> {
    let path = validate_log_path(path.as_ref())?;
    if let Some(parent) = path.parent() {
      create_dir_all(parent)?;
    }
    // Count existing lines so rotation is aware of prior content.
    let existing_lines = std::fs::read_to_string(&path)
      .map(|c| c.lines().count())
      .unwrap_or(0);
    let file = OpenOptions::new().create(true).append(true).open(&path)?;
    Ok(Self {
      inner: Mutex::new(TxLogInner {
        writer: BufWriter::new(file),
        line_count: existing_lines,
        last_write: Instant::now()
          .checked_sub(std::time::Duration::from_secs(1))
          .unwrap_or_else(Instant::now),
      }),
      path,
    })
  }

  pub fn path(&self) -> &Path {
    &self.path
  }

  pub fn write_entry(&self, entry: &TxLogEntry) -> io::Result<()> {
    let timestamp_ms = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .map(|d| d.as_millis())
      .unwrap_or_default();

    let mut guard = self.inner.lock().unwrap();

    // Throttle: skip non-critical writes that arrive too fast.
    // Always write Start/End phase transitions; throttle Change entries.
    if entry.phase == TxPhase::Change {
      let elapsed = guard.last_write.elapsed();
      if elapsed.as_millis() < MIN_WRITE_INTERVAL_MS as u128 {
        return Ok(());
      }
    }

    writeln!(guard.writer, "{}", entry.serialize(timestamp_ms))?;
    guard.line_count += 1;
    guard.last_write = Instant::now();

    // Flush only on phase transitions (start/end), not on every change.
    if entry.phase != TxPhase::Change {
      guard.writer.flush()?;
    }

    // Rotate if we exceed the limit.
    if guard.line_count > ROTATION_MAX_LINES {
      // Flush before rotation.
      guard.writer.flush()?;
      drop(guard);
      self.rotate()?;
    }

    Ok(())
  }

  /// Truncate the log to the last `ROTATION_KEEP_LINES` lines.
  fn rotate(&self) -> io::Result<()> {
    let contents = std::fs::read_to_string(&self.path).unwrap_or_default();
    let lines: Vec<&str> = contents.lines().collect();
    let keep_from = lines.len().saturating_sub(ROTATION_KEEP_LINES);
    let kept: String = lines[keep_from..]
      .iter()
      .map(|l| format!("{}\n", l))
      .collect();
    std::fs::write(&self.path, &kept)?;

    // Re-open the file in append mode and update inner state.
    let file = OpenOptions::new().append(true).open(&self.path)?;
    let mut guard = self.inner.lock().unwrap();
    guard.writer = BufWriter::new(file);
    guard.line_count = lines.len() - keep_from;
    Ok(())
  }
}

fn validate_log_path(path: &Path) -> io::Result<PathBuf> {
  if path.file_name().is_none() {
    return Err(io::Error::new(
      io::ErrorKind::InvalidInput,
      "transaction log path must name a file",
    ));
  }
  if path
    .components()
    .any(|component| matches!(component, std::path::Component::ParentDir))
  {
    return Err(io::Error::new(
      io::ErrorKind::InvalidInput,
      "transaction log path cannot contain parent traversal",
    ));
  }

  let absolute = if path.is_absolute() {
    path.to_path_buf()
  } else {
    std::env::current_dir()?.join(path)
  };
  let allowed_roots = [std::env::temp_dir(), PathBuf::from("/tmp/n-apt")];
  let is_under_allowed_root = |candidate: &Path| {
    allowed_roots
      .iter()
      .any(|root| candidate == root || candidate.starts_with(root))
  };
  if !is_under_allowed_root(&absolute) {
    return Err(io::Error::new(
      io::ErrorKind::PermissionDenied,
      "transaction log path must remain under a temporary log directory",
    ));
  }

  if let Some(parent) = absolute.parent() {
    create_dir_all(parent)?;
    let canonical_parent = std::fs::canonicalize(parent)?;
    let canonical_roots = allowed_roots
      .iter()
      .filter_map(|root| std::fs::canonicalize(root).ok())
      .collect::<Vec<_>>();
    if !canonical_roots.iter().any(|root| {
      canonical_parent == *root || canonical_parent.starts_with(root)
    }) {
      return Err(io::Error::new(
        io::ErrorKind::PermissionDenied,
        "transaction log parent resolves outside a temporary log directory",
      ));
    }
  }

  if absolute.exists() {
    let canonical_path = std::fs::canonicalize(&absolute)?;
    let canonical_roots = allowed_roots
      .iter()
      .filter_map(|root| std::fs::canonicalize(root).ok())
      .collect::<Vec<_>>();
    if !canonical_roots
      .iter()
      .any(|root| canonical_path.starts_with(root))
    {
      return Err(io::Error::new(
        io::ErrorKind::PermissionDenied,
        "transaction log file resolves outside a temporary log directory",
      ));
    }
  }

  Ok(absolute)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn writes_expected_fields() {
    let dir = std::env::temp_dir()
      .join(format!("napt-tx-log-test-{}", std::process::id()));
    let path = dir.join("tx_log.txt");
    let logger = TxLogger::with_path(&path).unwrap();

    let entry = TxLogEntry::start(
      "HackRF One".to_string(),
      "abc123".to_string(),
      Some(2_400_000_000),
      Some(2_000_000),
      Some(-3.0),
      Some(12.0),
      Some(20.0),
      Some(true),
      Some(false),
      Some(false),
      Some(5),
    );
    logger.write_entry(&entry).unwrap();

    let contents = std::fs::read_to_string(&path).unwrap();
    assert!(contents.contains("phase=start"));
    assert!(contents.contains("device=HackRF One"));
    assert!(contents.contains("serial_number=abc123"));
    assert!(contents.contains("transmit=true"));
    assert!(contents.contains("center_frequency_hz=2400000000"));
    assert!(contents.contains("power_dbm=-3"));
  }

  #[test]
  fn rejects_parent_traversal() {
    let path = std::env::temp_dir()
      .join("napt-tx-log-test")
      .join("..")
      .join("outside.txt");
    let error = match TxLogger::with_path(path) {
      Ok(_) => panic!("traversal must be rejected"),
      Err(error) => error,
    };
    assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
  }
}
// Hot-reload probe 2: second harmless source change after the quiet window.
