use std::fs::{create_dir_all, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

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

pub struct TxLogger {
  file: Mutex<std::fs::File>,
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

pub fn write_global(entry: &TxLogEntry) {
  if let Some(logger) = global_tx_logger() {
    let _ = logger.write_entry(entry);
  }
}

impl TxLogger {
  pub fn new() -> io::Result<Self> {
    Self::with_path("/tmp/n-apt/tx_log.txt")
  }

  pub fn with_path<P: AsRef<Path>>(path: P) -> io::Result<Self> {
    let path = path.as_ref().to_path_buf();
    if let Some(parent) = path.parent() {
      create_dir_all(parent)?;
    }
    let file = OpenOptions::new()
      .create(true)
      .append(true)
      .open(&path)?;
    Ok(Self {
      file: Mutex::new(file),
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
    let mut guard = self.file.lock().unwrap();
    writeln!(guard, "{}", entry.serialize(timestamp_ms))?;
    guard.flush()
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn writes_expected_fields() {
    let dir = std::env::temp_dir().join(format!(
      "napt-tx-log-test-{}",
      std::process::id()
    ));
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
}
