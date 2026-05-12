use std::path::Path;

fn main() {
  println!("cargo:rerun-if-changed=build.rs");

  let target_arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
  if target_arch != "wasm32" {
    link_rtlsdr();
  }

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

fn try_pkg_config() -> bool {
  for package in ["librtlsdr", "rtlsdr"] {
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
