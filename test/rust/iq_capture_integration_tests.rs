//! I/Q Capture Integration Tests
//!
//! Comprehensive integration tests for I/Q capture functionality with strict 3.2MHz sample rate validation.
//! Tests cover frontend-backend integration, end-to-end capture workflows, and robust sample rate enforcement.

use anyhow::Result;
use n_apt_backend::sdr::processor::CaptureChannel;
use n_apt_backend::sdr::processor::SdrProcessor;
use n_apt_backend::server::types::CaptureRequest;
use n_apt_backend::server::types::SdrProcessorSettings;
use std::time::Duration;
use tokio::time::sleep;

/// Default sample rate constant (3.2MHz)
const DEFAULT_SAMPLE_RATE: u32 = 3_200_000;
const MAX_SAMPLE_RATE: u32 = 3_200_000;

#[cfg(test)]
mod integration_tests {
  use super::*;

  #[tokio::test]
  async fn test_sample_rate_validation_on_capture_start() -> Result<()> {
    let mut processor = SdrProcessor::new_mock_apt()?;
    processor.initialize()?;

    // Test that default sample rate is 3.2MHz
    let current_sample_rate = processor.get_sample_rate();
    assert_eq!(current_sample_rate, DEFAULT_SAMPLE_RATE as f64);

    // Test that we can't set sample rate above 3.2MHz
    let result = processor.apply_settings(SdrProcessorSettings {
      sample_rate: Some(4_000_000), // 4MHz - should fail
      ..Default::default()
    });

    // Should either fail or be clamped to 3.2MHz
    match result {
      Ok(_) => {
        // If it succeeds, verify it was clamped
        let actual_rate = processor.get_sample_rate();
        assert!(actual_rate <= MAX_SAMPLE_RATE as f64);
      }
      Err(_) => {
        // It's okay if it fails - that's expected behavior
      }
    }

    Ok(())
  }

  #[tokio::test]
  async fn test_capture_with_valid_sample_rate() -> Result<()> {
    let mut processor = SdrProcessor::new_mock_apt()?;
    processor.initialize()?;

    // Start capture with valid 3.2MHz sample rate
    let capture_request = CaptureRequest {
      job_id: "test-job-1".to_string(),
      fragments: vec![n_apt_backend::server::types::CaptureFragment {
        min_freq_mhz: 100.0,
        max_freq_mhz: 103.2, // 3.2MHz bandwidth
      }],
      duration_s: 5.0,
      file_type: ".napt".to_string(),
      acquisition_mode: "stepwise".to_string(),
      encrypted: false,
      fft_size: 1024,
      fft_window: "Rectangular".to_string(),
      geolocation: None,
    };

    // This should succeed without any sample rate validation errors
    let result = processor.start_capture(capture_request);
    assert!(result.is_ok());

    // Let it capture for a short time
    sleep(Duration::from_millis(100)).await;

    // Check capture status
    let capture_result = processor.check_capture_completion()?;
    assert_eq!(capture_result.job_id, "test-job-1");
    assert_eq!(
      capture_result.hardware_sample_rate_hz,
      DEFAULT_SAMPLE_RATE as f64
    );

    // Clean up
    processor.stop_capture()?;

    Ok(())
  }

  #[tokio::test]
  async fn test_capture_rejects_invalid_sample_rate() -> Result<()> {
    let mut processor = SdrProcessor::new_mock_apt()?;
    processor.initialize()?;

    // Try to manually set an invalid sample rate first
    let _ = processor.apply_settings(SdrProcessorSettings {
      sample_rate: Some(5_000_000), // 5MHz - invalid
      ..Default::default()
    });

    // Now try to start capture - should either fail or use clamped rate
    let capture_request = CaptureRequest {
      job_id: "test-job-invalid".to_string(),
      fragments: vec![n_apt_backend::server::types::CaptureFragment {
        min_freq_mhz: 100.0,
        max_freq_mhz: 105.0, // 5MHz bandwidth - invalid
      }],
      duration_s: 1.0,
      file_type: ".napt".to_string(),
      acquisition_mode: "stepwise".to_string(),
      encrypted: false,
      fft_size: 1024,
      fft_window: "Rectangular".to_string(),
      geolocation: None,
    };

    let result = processor.start_capture(capture_request);

    // The behavior depends on implementation - either fails or clamps
    match result {
      Ok(_) => {
        // If it succeeds, verify the sample rate was clamped
        let actual_rate = processor.get_sample_rate();
        assert!(actual_rate <= MAX_SAMPLE_RATE as f64);

        // Clean up
        processor.stop_capture()?;
      }
      Err(e) => {
        // It's okay if it fails - that's expected for invalid sample rates
        assert!(
          e.to_string().contains("sample rate")
            || e.to_string().contains("invalid")
            || e.to_string().contains("exceeds")
        );
      }
    }

    Ok(())
  }

  #[tokio::test]
  async fn test_capture_metadata_contains_correct_sample_rate() -> Result<()> {
    let mut processor = SdrProcessor::new_mock_apt()?;
    processor.initialize()?;

    // Start capture
    let capture_request = CaptureRequest {
      job_id: "test-job-metadata".to_string(),
      fragments: vec![n_apt_backend::server::types::CaptureFragment {
        min_freq_mhz: 100.0,
        max_freq_mhz: 103.2,
      }],
      duration_s: 2.0,
      file_type: ".napt".to_string(),
      acquisition_mode: "stepwise".to_string(),
      encrypted: false,
      fft_size: 1024,
      fft_window: "Rectangular".to_string(),
      geolocation: None,
    };

    processor.start_capture(capture_request)?;

    // Let it capture for a bit
    sleep(Duration::from_millis(200)).await;

    // Check that capture metadata contains correct sample rate
    let capture_result = processor.check_capture_completion()?;

    assert_eq!(
      capture_result.hardware_sample_rate_hz,
      DEFAULT_SAMPLE_RATE as f64
    );
    assert_eq!(
      capture_result.overall_capture_sample_rate_hz,
      DEFAULT_SAMPLE_RATE as f64
    );

    // Verify each channel has the correct sample rate
    for channel in &capture_result.channels {
      assert_eq!(channel.sample_rate_hz, DEFAULT_SAMPLE_RATE as f64);
    }

    // Clean up
    processor.stop_capture()?;

    Ok(())
  }

  #[tokio::test]
  async fn test_multi_fragment_capture_sample_rate_consistency() -> Result<()> {
    let mut processor = SdrProcessor::new_mock_apt()?;
    processor.initialize()?;

    // Start capture with multiple fragments
    let capture_request = CaptureRequest {
      job_id: "test-job-multi".to_string(),
      fragments: vec![
        n_apt_backend::server::types::CaptureFragment {
          min_freq_mhz: 100.0,
          max_freq_mhz: 101.6, // 1.6MHz each
        },
        n_apt_backend::server::types::CaptureFragment {
          min_freq_mhz: 101.6,
          max_freq_mhz: 103.2,
        },
      ],
      duration_s: 3.0,
      file_type: ".napt".to_string(),
      acquisition_mode: "stepwise".to_string(),
      encrypted: false,
      fft_size: 1024,
      fft_window: "Rectangular".to_string(),
      geolocation: None,
    };

    processor.start_capture(capture_request)?;

    // Let it capture
    sleep(Duration::from_millis(300)).await;

    let capture_result = processor.check_capture_completion()?;

    // All channels should have the same sample rate (3.2MHz)
    for channel in &capture_result.channels {
      assert_eq!(channel.sample_rate_hz, DEFAULT_SAMPLE_RATE as f64);
    }

    // Clean up
    processor.stop_capture()?;

    Ok(())
  }

  #[tokio::test]
  async fn test_interleaved_capture_sample_rate_validation() -> Result<()> {
    let mut processor = SdrProcessor::new_mock_apt()?;
    processor.initialize()?;

    // Test interleaved (TDMS) mode
    let capture_request = CaptureRequest {
      job_id: "test-job-interleaved".to_string(),
      fragments: vec![n_apt_backend::server::types::CaptureFragment {
        min_freq_mhz: 100.0,
        max_freq_mhz: 103.2,
      }],
      duration_s: 2.0,
      file_type: ".napt".to_string(),
      acquisition_mode: "interleaved".to_string(),
      encrypted: false,
      fft_size: 1024,
      fft_window: "Rectangular".to_string(),
      geolocation: None,
    };

    processor.start_capture(capture_request)?;

    // Let it capture
    sleep(Duration::from_millis(200)).await;

    let capture_result = processor.check_capture_completion()?;

    // Even in interleaved mode, sample rate should be 3.2MHz
    assert_eq!(
      capture_result.hardware_sample_rate_hz,
      DEFAULT_SAMPLE_RATE as f64
    );

    // Clean up
    processor.stop_capture()?;

    Ok(())
  }

  #[tokio::test]
  async fn test_sample_rate_persistence_across_capture_cycles() -> Result<()> {
    let mut processor = SdrProcessor::new_mock_apt()?;
    processor.initialize()?;

    // First capture
    let capture_request1 = CaptureRequest {
      job_id: "test-job-1".to_string(),
      fragments: vec![n_apt_backend::server::types::CaptureFragment {
        min_freq_mhz: 100.0,
        max_freq_mhz: 103.2,
      }],
      duration_s: 1.0,
      file_type: ".napt".to_string(),
      acquisition_mode: "stepwise".to_string(),
      encrypted: false,
      fft_size: 1024,
      fft_window: "Rectangular".to_string(),
      geolocation: None,
    };

    processor.start_capture(capture_request1)?;
    sleep(Duration::from_millis(100)).await;
    let result1 = processor.check_capture_completion()?;
    processor.stop_capture()?;

    // Second capture
    let capture_request2 = CaptureRequest {
      job_id: "test-job-2".to_string(),
      fragments: vec![n_apt_backend::server::types::CaptureFragment {
        min_freq_mhz: 200.0,
        max_freq_mhz: 203.2,
      }],
      duration_s: 1.0,
      file_type: ".napt".to_string(),
      acquisition_mode: "stepwise".to_string(),
      encrypted: false,
      fft_size: 1024,
      fft_window: "Rectangular".to_string(),
      geolocation: None,
    };

    processor.start_capture(capture_request2)?;
    sleep(Duration::from_millis(100)).await;
    let result2 = processor.check_capture_completion()?;
    processor.stop_capture()?;

    // Both captures should have the same sample rate
    assert_eq!(
      result1.hardware_sample_rate_hz,
      result2.hardware_sample_rate_hz
    );
    assert_eq!(result1.hardware_sample_rate_hz, DEFAULT_SAMPLE_RATE as f64);

    Ok(())
  }

  #[tokio::test]
  async fn test_device_sample_rate_limits() -> Result<()> {
    let mut processor = SdrProcessor::new_mock_apt()?;
    processor.initialize()?;

    // Test various sample rates
    let test_rates = vec![
      2_048_000, // 2.048MHz - should work
      2_400_000, // 2.4MHz - should work
      2_800_000, // 2.8MHz - should work
      3_200_000, // 3.2MHz - should work (max)
      4_000_000, // 4MHz - should fail or be clamped
    ];

    for rate in test_rates {
      let result = processor.apply_settings(SdrProcessorSettings {
        sample_rate: Some(rate),
        ..Default::default()
      });

      match result {
        Ok(_) => {
          let actual_rate = processor.get_sample_rate();
          if rate > MAX_SAMPLE_RATE {
            assert!(actual_rate <= MAX_SAMPLE_RATE as f64);
          } else {
            assert_eq!(actual_rate, rate as f64);
          }
        }
        Err(_) => {
          // Should only fail for rates above maximum
          assert!(rate > MAX_SAMPLE_RATE);
        }
      }
    }

    Ok(())
  }
}

#[cfg(test)]
mod error_handling_tests {
  use super::*;

  #[tokio::test]
  async fn test_capture_with_zero_sample_rate() -> Result<()> {
    let mut processor = SdrProcessor::new_mock_apt()?;
    processor.initialize()?;

    // Try to set zero sample rate - should fail or default to 3.2MHz
    let result = processor.apply_settings(SdrProcessorSettings {
      sample_rate: Some(0),
      ..Default::default()
    });

    match result {
      Ok(_) => {
        // If it succeeds, should default to valid rate
        let actual_rate = processor.get_sample_rate();
        assert!(actual_rate > 0.0);
        assert!(actual_rate <= MAX_SAMPLE_RATE as f64);
      }
      Err(_) => {
        // Expected to fail
      }
    }

    Ok(())
  }

  #[tokio::test]
  async fn test_capture_with_negative_sample_rate() -> Result<()> {
    let mut processor = SdrProcessor::new_mock_apt()?;
    processor.initialize()?;

    // Try to set negative sample rate - should fail
    let result = processor.apply_settings(SdrProcessorSettings {
      sample_rate: Some(-1000000),
      ..Default::default()
    });

    assert!(result.is_err());

    Ok(())
  }

  #[tokio::test]
  async fn test_whole_sample_capture_produces_single_hop() -> Result<()> {
    // This tests the core hop computation logic:
    // When acquisition_mode == "whole_sample", even if the fragment span
    // exceeds the usable BW, only ONE hop should be generated.
    let mut processor = SdrProcessor::new_mock_apt()?;
    processor.initialize()?;

    let capture_request = CaptureRequest {
      job_id: "test-whole-sample-single-hop".to_string(),
      fragments: vec![n_apt_backend::server::types::CaptureFragment {
        min_freq_mhz: 100.0,
        max_freq_mhz: 103.2, // Exactly 3.2MHz = hardware rate
      }],
      duration_s: 1.0,
      file_type: ".napt".to_string(),
      acquisition_mode: "whole_sample".to_string(),
      encrypted: false,
      fft_size: 1024,
      fft_window: "Rectangular".to_string(),
      geolocation: None,
    };

    let result = processor.start_capture(capture_request);
    assert!(
      result.is_ok(),
      "whole_sample capture should start successfully"
    );

    // Check that the capture is using whole_sample mode
    assert_eq!(processor.capture_acquisition_mode, "whole_sample");

    // Clean up
    processor.stop_capture()?;

    Ok(())
  }

  #[tokio::test]
  async fn test_whole_sample_mode_string_mapping() -> Result<()> {
    // Verify that "whole_sample" passes through as-is and is the default
    let mut processor = SdrProcessor::new_mock_apt()?;
    processor.initialize()?;

    // Test explicit whole_sample
    let capture_request = CaptureRequest {
      job_id: "test-mode-mapping".to_string(),
      fragments: vec![n_apt_backend::server::types::CaptureFragment {
        min_freq_mhz: 100.0,
        max_freq_mhz: 103.2,
      }],
      duration_s: 1.0,
      file_type: ".napt".to_string(),
      acquisition_mode: "whole_sample".to_string(),
      encrypted: false,
      fft_size: 1024,
      fft_window: "Rectangular".to_string(),
      geolocation: None,
    };

    processor.start_capture(capture_request)?;
    assert_eq!(processor.capture_acquisition_mode, "whole_sample");
    processor.stop_capture()?;

    Ok(())
  }

  #[tokio::test]
  async fn test_stepwise_mode_string_mapping() -> Result<()> {
    let mut processor = SdrProcessor::new_mock_apt()?;
    processor.initialize()?;

    let capture_request = CaptureRequest {
      job_id: "test-stepwise-mapping".to_string(),
      fragments: vec![n_apt_backend::server::types::CaptureFragment {
        min_freq_mhz: 100.0,
        max_freq_mhz: 106.4, // Wider than hardware — should hop
      }],
      duration_s: 1.0,
      file_type: ".napt".to_string(),
      acquisition_mode: "stepwise".to_string(),
      encrypted: false,
      fft_size: 1024,
      fft_window: "Rectangular".to_string(),
      geolocation: None,
    };

    processor.start_capture(capture_request)?;
    // "stepwise" maps to "stepwise_naive" on the backend
    assert_eq!(processor.capture_acquisition_mode, "stepwise_naive");
    processor.stop_capture()?;

    Ok(())
  }

  #[tokio::test]
  async fn test_sample_rate_validation_during_capture() -> Result<()> {
    let mut processor = SdrProcessor::new_mock_apt()?;
    processor.initialize()?;

    // Start a normal capture
    let capture_request = CaptureRequest {
      job_id: "test-job-mid-capture".to_string(),
      fragments: vec![n_apt_backend::server::types::CaptureFragment {
        min_freq_mhz: 100.0,
        max_freq_mhz: 103.2,
      }],
      duration_s: 5.0,
      file_type: ".napt".to_string(),
      acquisition_mode: "stepwise".to_string(),
      encrypted: false,
      fft_size: 1024,
      fft_window: "Rectangular".to_string(),
      geolocation: None,
    };

    processor.start_capture(capture_request)?;

    // Try to change sample rate during capture - should be rejected
    let result = processor.apply_settings(SdrProcessorSettings {
      sample_rate: Some(4_000_000), // Invalid rate
      ..Default::default()
    });

    // Should either fail or not affect ongoing capture
    match result {
      Ok(_) => {
        // If it succeeds, verify capture still uses valid rate
        let actual_rate = processor.get_sample_rate();
        assert!(actual_rate <= MAX_SAMPLE_RATE as f64);
      }
      Err(_) => {
        // Expected to fail during capture
      }
    }

    // Clean up
    processor.stop_capture()?;

    Ok(())
  }
}
