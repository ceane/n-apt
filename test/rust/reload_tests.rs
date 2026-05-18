use n_apt_backend::server::utils::{
  signals_config, signals_config_modified_at,
};
use serial_test::serial;
use std::fs;
use std::time::Duration;

fn write_signals_yaml(path: &std::path::Path, sample_rate: &str) {
  let content = format!(
    r#"
signals:
  mock_apt:
    channels:
      a:
        label: "A"
        freq_range_hz: [18000.0, 4470000.0]
        description: "Channel A"
  n_apt:
    channels:
      a:
        label: "A"
        freq_range_hz: [18000.0, 4390000.0]
        description: "Channel A"
  sdr:
    sample_rate: !frequency {sample_rate}
    center_frequency: !frequency 1.6MHz
    gain:
      tuner_gain: 49.6
      rtl_agc: false
      tuner_agc: false
    ppm: 1.0
    fft:
      default_size: 32768
      default_frame_rate: 60
      max_size: 262144
      max_frame_rate: 60
      size_to_frame_rate: {{}}
    display:
      min_db: -120
      max_db: 0
      padding: 20
"#
  );
  fs::write(path, content).expect("write signals.yaml");
}

struct CurrentDirGuard(std::path::PathBuf);

impl Drop for CurrentDirGuard {
  fn drop(&mut self) {
    let _ = std::env::set_current_dir(&self.0);
  }
}

#[test]
#[serial]
fn signals_config_hot_reloads_when_file_changes() {
  let original_dir = std::env::current_dir().expect("current dir");
  let _guard = CurrentDirGuard(original_dir.clone());
  let temp_dir = tempfile::tempdir().expect("tempdir");
  let signals_path = temp_dir.path().join("signals.yaml");

  write_signals_yaml(&signals_path, "3.2MHz");
  std::env::set_current_dir(temp_dir.path()).expect("set temp cwd");

  let initial = signals_config();
  assert_eq!(initial.signals.sdr.sample_rate, 3_200_000);
  let initial_modified =
    signals_config_modified_at().expect("initial modified");

  std::thread::sleep(Duration::from_millis(1200));
  write_signals_yaml(&signals_path, "4MHz");

  let reloaded = signals_config();
  assert_eq!(reloaded.signals.sdr.sample_rate, 4_000_000);

  let reloaded_modified =
    signals_config_modified_at().expect("reloaded modified");
  assert!(
    reloaded_modified > initial_modified,
    "signals.yaml modified timestamp should advance after reload"
  );
}
