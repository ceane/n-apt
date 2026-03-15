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

  println!("cargo:rustc-link-lib=dylib=rtlsdr");

  #[cfg(target_os = "macos")]
  {
    if Path::new("/opt/homebrew/opt/librtlsdr/lib").exists() {
      println!("cargo:rustc-link-search=native=/opt/homebrew/opt/librtlsdr/lib");
      println!("cargo:include=/opt/homebrew/opt/librtlsdr/include");
      return;
    }

    if Path::new("/usr/local/lib/librtlsdr.dylib").exists() {
      println!("cargo:rustc-link-search=native=/usr/local/lib");
      println!("cargo:include=/usr/local/include");
      return;
    }
  }

  #[cfg(target_os = "linux")]
  {
    for candidate in [
      "/usr/lib/x86_64-linux-gnu",
      "/usr/lib/aarch64-linux-gnu",
      "/usr/lib/arm-linux-gnueabihf",
      "/usr/local/lib",
      "/usr/lib",
      "/lib/x86_64-linux-gnu",
      "/lib/aarch64-linux-gnu",
    ] {
      if Path::new(candidate).exists() {
        println!("cargo:rustc-link-search=native={candidate}");
      }
    }
    if Path::new("/usr/include").exists() {
      println!("cargo:include=/usr/include");
    }
  }
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
