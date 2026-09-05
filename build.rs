use std::path::Path;
use std::path::PathBuf;

fn main() {
  println!("cargo:rerun-if-changed=build.rs");

  let target_arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
  if target_arch != "wasm32" {
    link_homebrew_libusb();
    link_rtlsdr();
    link_hackrf();
  }
  println!("cargo:rustc-check-cfg=cfg(has_hackrf)");

  // Check for decrypted modules (Surgical Encryption)
  let decrypted_marker =
    Path::new("src/encrypted-modules/tmp/rs/simd/fast_math.rs");
  if decrypted_marker.exists() {
    println!("cargo:rustc-cfg=rs_decrypted");
  }
}

fn link_rtlsdr() {
  if link_homebrew_library("librtlsdr", "rtlsdr") {
    return;
  }

  if try_pkg_config() {
    return;
  }

  panic!(
    "librtlsdr/rtlsdr not found. Install the native library and pkg-config, then rerun cargo."
  );
}

fn link_homebrew_libusb() {
  if !cfg!(target_os = "macos") {
    return;
  }

  for candidate in ["/opt/homebrew/opt/libusb/lib", "/usr/local/opt/libusb/lib"]
  {
    let path = PathBuf::from(candidate);
    if path.exists() {
      println!("cargo:rustc-link-search=native={}", path.display());
      return;
    }
  }
}

fn link_hackrf() {
  if link_homebrew_library("hackrf", "hackrf")
    || try_pkg_config_for(&["libhackrf", "hackrf"])
  {
    println!("cargo:rustc-cfg=has_hackrf");
  }
}

fn link_homebrew_library(formula: &str, library: &str) -> bool {
  if !cfg!(target_os = "macos") {
    return false;
  }

  for prefix in ["/opt/homebrew", "/usr/local"] {
    if let Some(path) = homebrew_library_dir(Path::new(prefix), formula) {
      println!("cargo:rustc-link-search=native={}", path.display());
      println!("cargo:rustc-link-lib={}", library);
      return true;
    }
  }

  false
}

fn homebrew_library_dir(prefix: &Path, formula: &str) -> Option<PathBuf> {
  let path = prefix.join("opt").join(formula).join("lib");
  path.is_dir().then_some(path)
}

fn try_pkg_config() -> bool {
  try_pkg_config_for(&["librtlsdr", "rtlsdr"])
}

fn try_pkg_config_for(packages: &[&str]) -> bool {
  for package in packages {
    if pkg_config::Config::new()
      .cargo_metadata(true)
      .probe(package)
      .is_ok()
    {
      return true;
    }
  }
  false
}

#[cfg(test)]
mod tests {
  use super::homebrew_library_dir;
  use std::fs;
  use std::path::PathBuf;

  #[test]
  fn homebrew_library_dir_uses_stable_opt_path() {
    let root = std::env::temp_dir()
      .join(format!("n-apt-build-script-test-{}", std::process::id()));
    let library_dir: PathBuf = root.join("opt").join("librtlsdr").join("lib");
    fs::create_dir_all(&library_dir).unwrap();

    assert_eq!(homebrew_library_dir(&root, "librtlsdr"), Some(library_dir));
    fs::remove_dir_all(root).unwrap();
  }
}
