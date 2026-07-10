fn main() {
  let (s, c) = (1.0f64).sin_cos();
  println!("sin: {}, cos: {}", s, c);
  println!(
    "f64::sin(1.0): {}, f64::cos(1.0): {}",
    1.0f64.sin(),
    1.0f64.cos()
  );
}
