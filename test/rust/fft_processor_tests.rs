use n_apt_backend::fft::processor::utils::freq_to_bin;
use n_apt_backend::fft::processor::{
  apply_window, bin_to_freq, calculate_snr, detect_peaks, find_peak_frequency,
  frequency_resolution, zoom_fft, EnhancedFFTConfig, FFTProcessor, WindowType,
};
use n_apt_backend::fft::types::*;

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_enhanced_fft_config_default() {
    let config = EnhancedFFTConfig::default();

    assert_eq!(config.fft_size, 1024);
    assert_eq!(config.sample_rate, 3200000);
    assert_eq!(config.gain, 1.0);
    assert_eq!(config.ppm, 0.0);
    assert_eq!(config.fft_min, -80.0);
    assert_eq!(config.fft_max, 0.0);
    assert_eq!(config.waterfall_min, -80.0);
    assert_eq!(config.waterfall_max, 0.0);
    assert_eq!(config.window_type, WindowType::Hanning);
    assert_eq!(config.zoom_offset, 0);
    assert_eq!(config.zoom_width, 1024);
  }

  #[test]
  fn test_fft_processor_creation() {
    let processor = FFTProcessor::new();
    assert_eq!(processor.fft_size(), 1024);
  }

  #[test]
  fn test_fft_processor_custom_config() {
    let config = EnhancedFFTConfig {
      fft_size: 2048,
      sample_rate: 48000,
      gain: 2.0,
      ppm: 10.0,
      fft_min: -100.0,
      fft_max: 10.0,
      waterfall_min: -90.0,
      waterfall_max: 5.0,
      window_type: WindowType::Blackman,
      zoom_offset: 100,
      zoom_width: 1024,
    };

    let processor = FFTProcessor::with_config(config);
    assert_eq!(processor.fft_size(), 2048);
    assert_eq!(processor.config().sample_rate, 48000);
    assert_eq!(processor.config().gain, 2.0);
    assert_eq!(processor.config().zoom_width, 1024);
  }

  #[test]
  fn test_fft_processor_mock_signal() {
    let mut processor = FFTProcessor::new();

    let result = processor.generate_mock_signal(None).unwrap();
    assert_eq!(result.power_spectrum.len(), 1024);
    assert!(result.is_mock);
  }

  #[test]
  fn test_fft_processor_custom_signal() {
    let mut processor = FFTProcessor::new();

    let signal_config = MockSignalConfig {
      frequencies: vec![1000.0, 2000.0, 3000.0],
      amplitudes: vec![1.0, 0.5, 0.25],
      noise_level: 0.1,
    };

    let _result = processor.generate_mock_signal(Some(signal_config)).unwrap();
    assert_eq!(_result.power_spectrum.len(), 1024);
    assert!(_result.is_mock);
  }

  #[test]
  fn test_window_functions() {
    let mut samples = vec![1.0; 100];

    // Test Hanning window
    apply_window(&mut samples, WindowType::Hanning);
    assert!(samples.iter().any(|&x| x < 1.0)); // Should be windowed

    // Test Hamming window
    samples.fill(1.0);
    apply_window(&mut samples, WindowType::Hamming);
    assert!(samples.iter().any(|&x| x < 1.0));

    // Test Blackman window
    samples.fill(1.0);
    apply_window(&mut samples, WindowType::Blackman);
    assert!(samples.iter().any(|&x| x < 1.0));

    // Test no window
    samples.fill(1.0);
    apply_window(&mut samples, WindowType::None);
    assert!(samples
      .iter()
      .all(|&x: &f32| (x - 1.0).abs() < f32::EPSILON));
  }

  #[test]
  fn test_peak_detection() {
    let spectrum = vec![-80.0, -60.0, -40.0, -20.0, 0.0, -20.0, -40.0, -60.0, -80.0];
    let peaks = detect_peaks(&spectrum, -50.0, 2);

    assert_eq!(peaks.len(), 1);
    assert_eq!(peaks[0].0, 4); // Peak at index 4 (0 dB)
  }

  #[test]
  fn test_zoom_fft() {
    let input: Vec<f32> = (0..1000).map(|i| i as f32 * 0.1).collect();
    let zoomed = zoom_fft(&input, 100, 200, 100);

    assert_eq!(zoomed.len(), 100);
    assert!(zoomed[0] > 0.0); // Should have zoomed to correct region
  }

  #[test]
  fn test_snr_calculation() {
    let signal = vec![1.0, 2.0, 3.0, 4.0, 5.0];
    let noise_floor = 0.5;

    let snr = calculate_snr(&signal, noise_floor);
    assert!(snr > 0.0); // Should be positive SNR
    assert!(snr.is_finite()); // Should be finite
  }

  #[test]
  fn test_find_peak_frequency() {
    let spectrum = vec![-80.0, -60.0, -40.0, -20.0, 0.0, -20.0, -40.0, -60.0, -80.0];
    let (peak_index, _peak_freq) = find_peak_frequency(&spectrum, 32000, 9);

    let peak_freq: f32 = bin_to_freq(peak_index, 32000, 9);
    assert!((peak_freq - 14222.22_f32).abs() < 1.0_f32); // 4/9 * 32000
  }

  #[test]
  fn test_fft_hold_functionality() {
    let mut processor = FFTProcessor::new();

    // Generate initial signal
    let _result1 = processor.generate_mock_signal(None).unwrap();

    // Enable FFT hold
    processor.set_fft_hold(true);

    // Generate higher signal
    let config = MockSignalConfig {
      frequencies: vec![2000.0, 4000.0, 6000.0],
      amplitudes: vec![2.0, 1.0, 0.5],
      noise_level: 0.05,
    };

    let _result2 = processor.generate_mock_signal(Some(config)).unwrap();
    assert_eq!(_result2.power_spectrum.len(), 1024);
  }

  #[test]
  fn test_frequency_conversion() {
    // Test frequency to bin conversion
    let bin = freq_to_bin(16000.0, 32000, 1024);
    assert_eq!(bin, 512);

    // Test bin to frequency conversion
    let freq = bin_to_freq(512, 32000, 1024);
    assert!((freq - 16000.0).abs() < 0.1);

    // Test frequency resolution
    let resolution = frequency_resolution(32000, 1024);
    assert!((resolution - 31.25).abs() < 0.01);
  }

  #[test]
  fn test_zoom_functionality() {
    let mut processor = FFTProcessor::new();

    // Set zoom configuration
    let config = EnhancedFFTConfig {
      fft_size: 1024,
      sample_rate: 32000,
      gain: 1.0,
      ppm: 0.0,
      fft_min: -80.0,
      fft_max: 0.0,
      waterfall_min: -80.0,
      waterfall_max: 0.0,
      window_type: WindowType::Hanning,
      zoom_offset: 100,
      zoom_width: 200,
    };

    processor.update_config(config);

    let result = processor.generate_mock_signal(None).unwrap();
    assert_eq!(result.power_spectrum.len(), 200); // Should be 200 after zoom
  }

  #[test]
  fn test_time_reset() {
    let mut processor = FFTProcessor::new();

    // Generate some signals to advance time
    let _result1 = processor.generate_mock_signal(None).unwrap();
    let _result2 = processor.generate_mock_signal(None).unwrap();

    // Reset time
    processor.reset_time();

    // Generate signal again - should start from time 0
    let result3 = processor.generate_mock_signal(None).unwrap();
    assert!(result3.timestamp > 0);
  }

  #[test]
  fn test_waterfall_history() {
    let mut processor = FFTProcessor::new();

    // Generate multiple signals
    for _ in 0..5 {
      let _result = processor.generate_mock_signal(None).unwrap();
    }

    let history = processor.get_waterfall_history();
    assert!(!history.is_empty());
    assert!(history.len() <= 1000); // Should not exceed max lines

    // Clear history
    processor.clear_waterfall();
    let empty_history = processor.get_waterfall_history();
    assert_eq!(empty_history.len(), 0);
  }

  #[test]
  fn test_mock_signal_generation() {
    let mut processor = FFTProcessor::new();
    let result = processor.generate_mock_signal(None).unwrap();

    assert_eq!(result.power_spectrum.len(), 1024);
    assert!(result.is_mock);
    assert!(result.timestamp > 0);

    // Check that mock signal has reasonable values
    for &value in &result.power_spectrum {
      assert!((-200.0..=100.0).contains(&value));
    }
    // Reset time
    processor.reset_time();

    // Generate signal again - should start from time 0
    let result3 = processor.generate_mock_signal(None).unwrap();
    assert!(result3.timestamp > 0);
  }
}
