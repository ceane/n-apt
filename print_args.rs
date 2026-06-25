fn main() {
    let tx_sample_rate_hz = 100_000.0;
    let sample_rate = if tx_sample_rate_hz > 0.0 {
        tx_sample_rate_hz.round().clamp(1.0, u32::MAX as f64) as u32
    } else {
        3_200_000
    }.max(3_200_000);
    
    println!("sample_rate: {}", sample_rate);
}
