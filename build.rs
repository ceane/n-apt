use std::path::Path;

fn main() {
  println!("cargo:rerun-if-changed=build.rs");

  let target_arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
  if target_arch != "wasm32" {
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
  if try_pkg_config() {
    return;
  }

  panic!(
    "librtlsdr/rtlsdr not found. Install the native library and pkg-config, then rerun cargo."
  );
}

fn link_hackrf() {
  if try_pkg_config_for(&["libhackrf", "hackrf"]) {
    println!("cargo:rustc-cfg=has_hackrf");
  }
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
