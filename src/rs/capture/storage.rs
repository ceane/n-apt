//! Durable local storage for completed captures and their recovery manifests.

use crate::server::types::CaptureArtifact;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const STORAGE_ENV: &str = "N_APT_CAPTURE_STORAGE_PATH";
const DOWNLOADS_ENV: &str = "N_APT_CAPTURE_DOWNLOADS_PATH";
const BACKUP_ENV: &str = "N_APT_CAPTURE_BACKUP_PATH";

fn home_dir() -> PathBuf {
  std::env::var_os("HOME")
    .map(PathBuf::from)
    .unwrap_or_else(std::env::temp_dir)
}

fn configured_or_default(
  path: Option<std::ffi::OsString>,
  default: PathBuf,
) -> PathBuf {
  path
    .map(PathBuf::from)
    .filter(|path| path.is_absolute())
    .unwrap_or(default)
}

pub fn capture_storage_dir() -> PathBuf {
  configured_or_default(
    std::env::var_os(STORAGE_ENV),
    home_dir().join(".n-apt/captures"),
  )
}

pub fn replica_capture_dirs() -> Vec<PathBuf> {
  let home = home_dir();
  let downloads = configured_or_default(
    std::env::var_os(DOWNLOADS_ENV),
    home.join("Downloads/N-APT Captures"),
  );
  let mut paths = vec![downloads];
  if let Some(path) = std::env::var_os(BACKUP_ENV).map(PathBuf::from) {
    if path.is_absolute() {
      paths.push(path);
    }
  }
  paths
}

fn artifact_directories() -> Vec<PathBuf> {
  let mut paths = vec![capture_storage_dir()];
  paths.extend(replica_capture_dirs());
  let mut unique = Vec::with_capacity(paths.len());
  for path in paths {
    if !unique.contains(&path) {
      unique.push(path);
    }
  }
  unique
}

fn safe_basename(name: &str) -> bool {
  let path = Path::new(name);
  !name.is_empty()
    && !name.contains(['/', '\\'])
    && path.components().count() == 1
    && matches!(
      path.components().next(),
      Some(std::path::Component::Normal(_))
    )
}

fn copy_atomically(source: &Path, target: &Path) -> std::io::Result<()> {
  if target.exists() {
    let mut existing = fs::File::open(target)?;
    let mut source_file = fs::File::open(source)?;
    let mut existing_bytes = Vec::new();
    let mut source_bytes = Vec::new();
    existing.read_to_end(&mut existing_bytes)?;
    source_file.read_to_end(&mut source_bytes)?;
    return if existing_bytes == source_bytes {
      Ok(())
    } else {
      Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "capture destination already contains different data",
      ))
    };
  }

  let parent = target.parent().ok_or_else(|| {
    std::io::Error::new(
      std::io::ErrorKind::InvalidInput,
      "capture path has no parent",
    )
  })?;
  fs::create_dir_all(parent)?;
  let nonce = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_nanos())
    .unwrap_or(0);
  let temp = parent.join(format!(".capture-{nonce}.tmp"));
  let result = (|| {
    let mut input = fs::File::open(source)?;
    let mut output = OpenOptions::new()
      .write(true)
      .create_new(true)
      .open(&temp)?;
    std::io::copy(&mut input, &mut output)?;
    output.flush()?;
    output.sync_all()?;
    fs::rename(&temp, target)?;
    Ok(())
  })();
  if result.is_err() {
    let _ = fs::remove_file(&temp);
  }
  result
}

/// Copy a finished artifact to a durable user-data directory, Downloads, and
/// the optional `N_APT_CAPTURE_BACKUP_PATH`. `N_APT_CAPTURE_DOWNLOADS_PATH`
/// can override the Downloads replica directory. Returns the canonical path.
pub fn replicate_capture_file(
  source: &Path,
  filename: &str,
) -> Result<PathBuf, String> {
  replicate_capture_file_into(source, filename, &artifact_directories())
}

fn replicate_capture_file_into(
  source: &Path,
  filename: &str,
  directories: &[PathBuf],
) -> Result<PathBuf, String> {
  if !safe_basename(filename) {
    return Err("capture filename must be a safe basename".into());
  }
  let primary = directories[0].join(filename);
  if source != primary {
    copy_atomically(source, &primary).map_err(|error| {
      format!(
        "failed to persist capture in {}: {error}",
        primary.display()
      )
    })?;
  }
  for directory in directories.iter().skip(1) {
    let target = directory.join(filename);
    if target != source {
      copy_atomically(source, &target).map_err(|error| {
        format!(
          "failed to create capture copy in {}: {error}",
          target.display()
        )
      })?;
    }
  }
  Ok(primary)
}

/// Write a non-expiring disk recovery index alongside capture bytes and mirrors.
pub fn write_job_manifest(
  job_id: &str,
  artifacts: &[CaptureArtifact],
) -> Result<(), String> {
  if !safe_basename(job_id) {
    return Err("capture job ID must be a safe basename".into());
  }
  let bytes = serde_json::to_vec_pretty(artifacts).map_err(|error| {
    format!("failed to serialize capture recovery manifest: {error}")
  })?;
  for directory in artifact_directories() {
    let manifest_dir = directory.join("manifests");
    fs::create_dir_all(&manifest_dir).map_err(|error| {
      format!(
        "failed to create capture manifest directory {}: {error}",
        manifest_dir.display()
      )
    })?;
    let path = manifest_dir.join(format!("{job_id}.json"));
    let nonce = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .map(|duration| duration.as_nanos())
      .unwrap_or(0);
    let temp = manifest_dir
      .join(format!(".{job_id}-{}-{nonce}.tmp", std::process::id()));
    fs::write(&temp, &bytes).map_err(|error| {
      format!(
        "failed to stage capture recovery manifest {}: {error}",
        temp.display()
      )
    })?;
    if let Err(error) = fs::rename(&temp, &path) {
      let _ = fs::remove_file(&temp);
      return Err(format!(
        "failed to persist capture recovery manifest {}: {error}",
        path.display()
      ));
    }
  }
  Ok(())
}

pub fn read_job_manifest(
  job_id: &str,
) -> Result<Option<Vec<CaptureArtifact>>, String> {
  if !safe_basename(job_id) {
    return Err("capture job ID must be a safe basename".into());
  }
  for directory in artifact_directories() {
    let path = directory.join("manifests").join(format!("{job_id}.json"));
    match fs::read(&path) {
      Ok(bytes) => {
        let artifacts = serde_json::from_slice(&bytes).map_err(|error| {
          format!(
            "capture recovery manifest {} is invalid: {error}",
            path.display()
          )
        })?;
        return Ok(Some(artifacts));
      }
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
      Err(error) => {
        return Err(format!(
          "failed to read capture recovery manifest {}: {error}",
          path.display()
        ))
      }
    }
  }
  Ok(None)
}

/// Repoint Redis or disk metadata at a surviving file replica when the
/// canonical capture store is unavailable.
pub fn recover_artifact_paths(
  artifacts: &[CaptureArtifact],
) -> Result<Vec<CaptureArtifact>, String> {
  recover_artifact_paths_with_dirs(artifacts, &replica_capture_dirs())
}

fn recover_artifact_paths_with_dirs(
  artifacts: &[CaptureArtifact],
  replica_dirs: &[PathBuf],
) -> Result<Vec<CaptureArtifact>, String> {
  let mut recovered = Vec::with_capacity(artifacts.len());
  for artifact in artifacts {
    if artifact.path.is_file() {
      recovered.push(artifact.clone());
      continue;
    }
    let replacement = replica_dirs
      .iter()
      .map(|directory| directory.join(&artifact.filename))
      .find(|path| path.is_file())
      .ok_or_else(|| {
        format!("capture artifact {} has no available copy", artifact.filename)
      })?;
    let mut copy = artifact.clone();
    copy.path = replacement;
    recovered.push(copy);
  }
  Ok(recovered)
}

#[cfg(test)]
mod tests {
  use super::*;
  use serial_test::serial;

  const TEST_DOWNLOADS_ENV: &str = "N_APT_CAPTURE_DOWNLOADS_PATH";

  struct RestoreEnv {
    key: &'static str,
    value: Option<std::ffi::OsString>,
  }

  impl RestoreEnv {
    fn capture(key: &'static str) -> Self {
      Self {
        key,
        value: std::env::var_os(key),
      }
    }
  }

  impl Drop for RestoreEnv {
    fn drop(&mut self) {
      if let Some(value) = self.value.take() {
        std::env::set_var(self.key, value);
      } else {
        std::env::remove_var(self.key);
      }
    }
  }

  #[test]
  fn configured_paths_ignore_relative_values() {
    let path = configured_or_default(
      Some("relative/captures".into()),
      PathBuf::from("/home/test/.n-apt/captures"),
    );
    assert_eq!(path, PathBuf::from("/home/test/.n-apt/captures"));
  }

  #[test]
  #[serial]
  fn downloads_path_uses_absolute_override() {
    let _restore = RestoreEnv::capture(TEST_DOWNLOADS_ENV);
    let override_path = PathBuf::from("/tmp/napt-test-downloads");
    std::env::set_var(TEST_DOWNLOADS_ENV, &override_path);
    assert_eq!(replica_capture_dirs()[0], override_path);
  }

  #[test]
  #[serial]
  fn downloads_path_ignores_relative_override() {
    let _restore = RestoreEnv::capture(TEST_DOWNLOADS_ENV);
    let home = home_dir();
    std::env::set_var(TEST_DOWNLOADS_ENV, "relative/downloads");
    assert_eq!(
      replica_capture_dirs()[0],
      home.join("Downloads/N-APT Captures"),
    );
  }

  #[test]
  fn artifact_names_reject_path_components() {
    assert!(safe_basename("capture-1.iq"));
    assert!(!safe_basename("../capture.iq"));
    assert!(!safe_basename("folder/capture.iq"));
  }

  #[test]
  fn copies_capture_to_primary_downloads_and_optional_backup() {
    let root = tempfile::tempdir().expect("temporary storage root");
    let source = root.path().join("source.iq");
    fs::write(&source, b"durable capture").expect("write source");
    let directories = vec![
      root.path().join("primary"),
      root.path().join("Downloads/N-APT Captures"),
      root.path().join("backup"),
    ];

    let saved =
      replicate_capture_file_into(&source, "capture.iq", &directories)
        .expect("replicate capture");

    assert_eq!(saved, directories[0].join("capture.iq"));
    for directory in directories {
      assert_eq!(
        fs::read(directory.join("capture.iq")).unwrap(),
        b"durable capture"
      );
    }
  }

  #[test]
  fn recovers_a_missing_primary_from_a_downloads_replica() {
    let root = tempfile::tempdir().expect("temporary storage root");
    let primary = root.path().join("primary");
    let downloads = root.path().join("downloads");
    let backup = root.path().join("backup");
    fs::create_dir_all(&downloads).expect("create downloads");
    fs::write(downloads.join("capture.iq"), b"replica bytes")
      .expect("write replica");
    let artifacts = vec![CaptureArtifact {
      filename: "capture.iq".into(),
      path: primary.join("capture.iq"),
      file_size: 13,
      checksum: String::new(),
    }];

    let recovered = recover_artifact_paths_with_dirs(
      &artifacts,
      &[downloads.clone(), backup],
    )
    .expect("recover replica");

    assert_eq!(recovered[0].path, downloads.join("capture.iq"));
  }
}
