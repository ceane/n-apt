fn main() {
  println!("cargo:rerun-if-changed=build.rs");

  // Link against librtlsdr
  // println!("cargo:rustc-link-lib=dylib=rtlsdr");

  // Add include path for RTL-SDR headers
  #[cfg(target_os = "macos")]
  {
    if std::path::Path::new("/usr/local/include/rtl-sdr").exists() {
      // println!("cargo:rustc-link-search=native=/usr/local/lib");
      // println!("cargo:include=/usr/local/include/rtl-sdr");
    } else if std::path::Path::new("/opt/homebrew/include/rtl-sdr").exists() {
      // println!("cargo:rustc-link-search=native=/opt/homebrew/lib");
      // println!("cargo:include=/opt/homebrew/include/rtl-sdr");
    }
  }

  #[cfg(target_os = "linux")]
  {
    // println!("cargo:rustc-link-search=native=/usr/lib");
    // println!("cargo:include=/usr/include/rtl-sdr");
  }
}
