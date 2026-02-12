fn main() {
  println!("cargo:rerun-if-changed=build.rs");

  // Only link librtlsdr on native (non-WASM) targets
  #[cfg(not(target_arch = "wasm32"))]
  {
    // Link against librtlsdr
    println!("cargo:rustc-link-lib=dylib=rtlsdr");

    // Add library/include search paths per platform
    #[cfg(target_os = "macos")]
    {
      if std::path::Path::new("/opt/homebrew/opt/librtlsdr/lib").exists() {
        println!("cargo:rustc-link-search=native=/opt/homebrew/opt/librtlsdr/lib");
        println!("cargo:include=/opt/homebrew/opt/librtlsdr/include");
      } else if std::path::Path::new("/usr/local/lib/librtlsdr.dylib").exists() {
        println!("cargo:rustc-link-search=native=/usr/local/lib");
        println!("cargo:include=/usr/local/include");
      }
    }

    #[cfg(target_os = "linux")]
    {
      println!("cargo:rustc-link-search=native=/usr/lib");
      println!("cargo:include=/usr/include");
    }
  }
}
