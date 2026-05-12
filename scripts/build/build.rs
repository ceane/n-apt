use std::path::Path;

fn main() {
  println!("cargo:rerun-if-changed=build.rs");

  #[cfg(not(target_arch = "wasm32"))]
  link_rtlsdr();
}

#[cfg(not(target_arch = "wasm32"))]
fn link_rtlsdr() {
  if try_pkg_config() {
    return;
  }

  panic!(
    "librtlsdr/rtlsdr not found. Install the native library and pkg-config, then rerun cargo."
  );
}

#[cfg(not(target_arch = "wasm32"))]
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
