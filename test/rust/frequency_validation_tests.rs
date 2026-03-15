//! Frequency Validation Tests
//! 
//! Comprehensive tests for frequency validation in I/Q capture functionality.
//! Ensures no negative frequencies are captured and frontend-backend frequency synchronization.

use n_apt_backend::sdr::processor::SdrProcessor;
use n_apt_backend::server::types::CaptureRequest;
use n_apt_backend::server::types::CaptureFragment;
use anyhow::Result;
use std::time::Duration;
use tokio::time::sleep;

/// Test frequency validation constants
const MIN_VALID_FREQ_HZ: u64 = 0;                 // 0Hz (RTL-SDR can tune to 0)
const MAX_VALID_FREQ_HZ: u64 = 1_766_000_000;   // 1766MHz (RTL-SDR maximum)
const SAMPLE_RATE_HZ: u64 = 3_200_000;          // 3.2MHz

#[cfg(test)]
mod frequency_validation_tests {
    use super::*;

    #[tokio::test]
    async fn test_reject_negative_frequencies() -> Result<()> {
        let mut processor = SdrProcessor::new_mock_apt()?;
        processor.initialize()?;

        // Try to capture with negative frequency
        let capture_request = CaptureRequest {
            job_id: "test-negative-freq".to_string(),
            fragments: vec![
                CaptureFragment {
                    min_freq_mhz: -10.0, // Negative frequency
                    max_freq_mhz: 100.0,
                }
            ],
            duration_s: 1.0,
            file_type: ".napt".to_string(),
            acquisition_mode: "stepwise".to_string(),
            encrypted: false,
            fft_size: 1024,
            fft_window: "Rectangular".to_string(),
            geolocation: None,
        };

        let result = processor.start_capture(capture_request);
        
        // Should fail with negative frequency error
        assert!(result.is_err());
        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("negative") || 
               error_msg.contains("invalid") ||
               error_msg.contains("frequency"));

        Ok(())
    }

    #[tokio::test]
    async fn test_allow_zero_frequency() -> Result<()> {
        let mut processor = SdrProcessor::new_mock_apt()?;
        processor.initialize()?;

        // Try to capture with 0Hz frequency - should be allowed for RTL-SDR
        let capture_request = CaptureRequest {
            job_id: "test-zero-freq".to_string(),
            fragments: vec![
                CaptureFragment {
                    min_freq_mhz: 0.0, // 0Hz - valid for RTL-SDR
                    max_freq_mhz: 3.0,  // 3MHz bandwidth
                }
            ],
            duration_s: 1.0,
            file_type: ".napt".to_string(),
            acquisition_mode: "stepwise".to_string(),
            encrypted: false,
            fft_size: 1024,
            fft_window: "Rectangular".to_string(),
            geolocation: None,
        };

        let result = processor.start_capture(capture_request);
        
        // Should succeed with 0Hz frequency
        assert!(result.is_ok());

        // Let it capture briefly
        sleep(Duration::from_millis(100)).await;

        // Verify capture metadata
        let capture_result = processor.check_capture_completion()?;
        assert_eq!(capture_result.job_id, "test-zero-freq");
        
        // Check that frequencies are valid (>= 0Hz)
        for channel in &capture_result.channels {
            assert!(channel.center_freq_hz >= 0.0);
        }

        // Clean up
        processor.stop_capture()?;

        Ok(())
    }

    #[tokio::test]
    async fn test_reject_frequency_range_with_negative_values() -> Result<()> {
        let mut processor = SdrProcessor::new_mock_apt()?;
        processor.initialize()?;

        // Try capture where range would include negative frequencies
        let capture_request = CaptureRequest {
            job_id: "test-range-negative".to_string(),
            fragments: vec![
                CaptureFragment {
                    min_freq_mhz: 10.0,
                    max_freq_mhz: -5.0, // Max < Min and negative
                }
            ],
            duration_s: 1.0,
            file_type: ".napt".to_string(),
            acquisition_mode: "stepwise".to_string(),
            encrypted: false,
            fft_size: 1024,
            fft_window: "Rectangular".to_string(),
            geolocation: None,
        };

        let result = processor.start_capture(capture_request);
        
        // Should fail
        assert!(result.is_err());

        Ok(())
    }

    #[tokio::test]
    async fn test_validate_frequency_range_order() -> Result<()> {
        let mut processor = SdrProcessor::new_mock_apt()?;
        processor.initialize()?;

        // Try capture with min > max
        let capture_request = CaptureRequest {
            job_id: "test-invalid-order".to_string(),
            fragments: vec![
                CaptureFragment {
                    min_freq_mhz: 200.0, // Higher than max
                    max_freq_mhz: 100.0,
                }
            ],
            duration_s: 1.0,
            file_type: ".napt".to_string(),
            acquisition_mode: "stepwise".to_string(),
            encrypted: false,
            fft_size: 1024,
            fft_window: "Rectangular".to_string(),
            geolocation: None,
        };

        let result = processor.start_capture(capture_request);
        
        // Should fail
        assert!(result.is_err());
        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("min") || 
               error_msg.contains("max") ||
               error_msg.contains("range") ||
               error_msg.contains("order"));

        Ok(())
    }

    #[tokio::test]
    async fn test_validate_device_frequency_limits() -> Result<()> {
        let mut processor = SdrProcessor::new_mock_apt()?;
        processor.initialize()?;

        // Test frequency at 0Hz - should be allowed for RTL-SDR
        let capture_request_zero = CaptureRequest {
            job_id: "test-zero-hz".to_string(),
            fragments: vec![
                CaptureFragment {
                    min_freq_mhz: 0.0,   // 0Hz - allowed for RTL-SDR
                    max_freq_mhz: 3.0,   // 3MHz bandwidth
                }
            ],
            duration_s: 1.0,
            file_type: ".napt".to_string(),
            acquisition_mode: "stepwise".to_string(),
            encrypted: false,
            fft_size: 1024,
            fft_window: "Rectangular".to_string(),
            geolocation: None,
        };

        let result_zero = processor.start_capture(capture_request_zero);
        assert!(result_zero.is_ok());
        processor.stop_capture()?;

        // Test frequency above device maximum
        let capture_request_high = CaptureRequest {
            job_id: "test-high-freq".to_string(),
            fragments: vec![
                CaptureFragment {
                    min_freq_mhz: 2000.0, // Above 1766MHz RTL-SDR maximum
                    max_freq_mhz: 2005.0,
                }
            ],
            duration_s: 1.0,
            file_type: ".napt".to_string(),
            acquisition_mode: "stepwise".to_string(),
            encrypted: false,
            fft_size: 1024,
            fft_window: "Rectangular".to_string(),
            geolocation: None,
        };

        let result_high = processor.start_capture(capture_request_high);
        assert!(result_high.is_err());

        Ok(())
    }

    #[tokio::test]
    async fn test_validate_bandwidth_constraints() -> Result<()> {
        let mut processor = SdrProcessor::new_mock_apt()?;
        processor.initialize()?;

        // Try bandwidth larger than sample rate
        let capture_request = CaptureRequest {
            job_id: "test-large-bandwidth".to_string(),
            fragments: vec![
                CaptureFragment {
                    min_freq_mhz: 100.0,
                    max_freq_mhz: 110.0, // 10MHz bandwidth > 3.2MHz sample rate
                }
            ],
            duration_s: 1.0,
            file_type: ".napt".to_string(),
            acquisition_mode: "stepwise".to_string(),
            encrypted: false,
            fft_size: 1024,
            fft_window: "Rectangular".to_string(),
            geolocation: None,
        };

        let result = processor.start_capture(capture_request);
        
        // Should fail due to bandwidth exceeding sample rate
        assert!(result.is_err());
        let error_msg = result.unwrap_err().to_string();
        assert!(error_msg.contains("bandwidth") || 
               error_msg.contains("sample") ||
               error_msg.contains("rate") ||
               error_msg.contains("wide"));

        Ok(())
    }

    #[tokio::test]
    async fn test_valid_frequency_capture() -> Result<()> {
        let mut processor = SdrProcessor::new_mock_apt()?;
        processor.initialize()?;

        // Valid frequency range
        let capture_request = CaptureRequest {
            job_id: "test-valid-freq".to_string(),
            fragments: vec![
                CaptureFragment {
                    min_freq_mhz: 100.0,
                    max_freq_mhz: 103.0, // 3MHz bandwidth < 3.2MHz sample rate
                }
            ],
            duration_s: 2.0,
            file_type: ".napt".to_string(),
            acquisition_mode: "stepwise".to_string(),
            encrypted: false,
            fft_size: 1024,
            fft_window: "Rectangular".to_string(),
            geolocation: None,
        };

        let result = processor.start_capture(capture_request);
        assert!(result.is_ok());

        // Let it capture briefly
        sleep(Duration::from_millis(100)).await;

        // Verify capture metadata contains correct frequencies
        let capture_result = processor.check_capture_completion()?;
        assert_eq!(capture_result.job_id, "test-valid-freq");
        
        // Check that frequencies are positive and within valid range
        for channel in &capture_result.channels {
            assert!(channel.center_freq_hz > 0.0);
            assert!(channel.center_freq_hz >= MIN_VALID_FREQ_HZ as f64);
            assert!(channel.center_freq_hz <= MAX_VALID_FREQ_HZ as f64);
        }

        // Clean up
        processor.stop_capture()?;

        Ok(())
    }

    #[tokio::test]
    async fn test_multi_fragment_frequency_validation() -> Result<()> {
        let mut processor = SdrProcessor::new_mock_apt()?;
        processor.initialize()?;

        // Test with multiple valid fragments
        let capture_request = CaptureRequest {
            job_id: "test-multi-frag".to_string(),
            fragments: vec![
                CaptureFragment {
                    min_freq_mhz: 100.0,
                    max_freq_mhz: 101.6,
                },
                CaptureFragment {
                    min_freq_mhz: 101.6,
                    max_freq_mhz: 103.2,
                }
            ],
            duration_s: 2.0,
            file_type: ".napt".to_string(),
            acquisition_mode: "stepwise".to_string(),
            encrypted: false,
            fft_size: 1024,
            fft_window: "Rectangular".to_string(),
            geolocation: None,
        };

        let result = processor.start_capture(capture_request);
        assert!(result.is_ok());

        sleep(Duration::from_millis(100)).await;

        let capture_result = processor.check_capture_completion()?;
        
        // All channels should have valid frequencies
        for channel in &capture_result.channels {
            assert!(channel.center_freq_hz > 0.0);
            assert!(channel.center_freq_hz >= 100.0 * 1000000.0);
            assert!(channel.center_freq_hz <= 103.2 * 1000000.0);
        }

        processor.stop_capture()?;

        Ok(())
    }

    #[tokio::test]
    async fn test_frequency_precision_validation() -> Result<()> {
        let mut processor = SdrProcessor::new_mock_apt()?;
        processor.initialize()?;

        // Test with high precision frequencies
        let capture_request = CaptureRequest {
            job_id: "test-precision".to_string(),
            fragments: vec![
                CaptureFragment {
                    min_freq_mhz: 100.123456789,
                    max_freq_mhz: 103.987654321,
                }
            ],
            duration_s: 1.0,
            file_type: ".napt".to_string(),
            acquisition_mode: "stepwise".to_string(),
            encrypted: false,
            fft_size: 1024,
            fft_window: "Rectangular".to_string(),
            geolocation: None,
        };

        let result = processor.start_capture(capture_request);
        assert!(result.is_ok());

        sleep(Duration::from_millis(100)).await;

        let capture_result = processor.check_capture_completion()?;
        
        // Verify frequencies are preserved with reasonable precision
        for channel in &capture_result.channels {
            assert!(channel.center_freq_hz > 0.0);
            // Allow some tolerance for hardware precision
            let expected_min = 100.123456789 * 1000000.0;
            let expected_max = 103.987654321 * 1000000.0;
            assert!(channel.center_freq_hz >= expected_min - 1000.0); // ±1kHz tolerance
            assert!(channel.center_freq_hz <= expected_max + 1000.0);
        }

        processor.stop_capture()?;

        Ok(())
    }
}

#[cfg(test)]
mod frequency_synchronization_tests {
    use super::*;

    #[tokio::test]
    async fn test_frontend_backend_frequency_sync() -> Result<()> {
        let mut processor = SdrProcessor::new_mock_apt()?;
        processor.initialize()?;

        // Simulate frontend request for specific frequencies
        let frontend_min_mhz = 144.0;
        let frontend_max_mhz = 146.0;
        
        let capture_request = CaptureRequest {
            job_id: "test-sync".to_string(),
            fragments: vec![
                CaptureFragment {
                    min_freq_mhz: frontend_min_mhz,
                    max_freq_mhz: frontend_max_mhz,
                }
            ],
            duration_s: 2.0,
            file_type: ".napt".to_string(),
            acquisition_mode: "stepwise".to_string(),
            encrypted: false,
            fft_size: 1024,
            fft_window: "Rectangular".to_string(),
            geolocation: None,
        };

        processor.start_capture(capture_request)?;
        sleep(Duration::from_millis(100)).await;

        let capture_result = processor.check_capture_completion()?;
        
        // Verify backend captured at requested frequencies
        assert_eq!(capture_result.channels.len(), 1);
        let channel = &capture_result.channels[0];
        
        // Center frequency should be midpoint of requested range
        let expected_center = (frontend_min_mhz + frontend_max_mhz) / 2.0 * 1000000.0;
        assert!((channel.center_freq_hz - expected_center).abs() < 1000.0); // ±1kHz tolerance
        
        // Verify no frequency drift into negative ranges
        assert!(channel.center_freq_hz > 0.0);
        assert!(channel.center_freq_hz >= frontend_min_mhz * 1000000.0);
        assert!(channel.center_freq_hz <= frontend_max_mhz * 1000000.0);

        processor.stop_capture()?;

        Ok(())
    }

    #[tokio::test]
    async fn test_frequency_range_edge_cases() -> Result<()> {
        let mut processor = SdrProcessor::new_mock_apt()?;
        processor.initialize()?;

        // Test edge of device capabilities
        let edge_cases = vec![
            (24.0, 27.0),    // At minimum device frequency
            (1763.0, 1766.0), // At maximum device frequency
            (100.0, 100.001), // Very small bandwidth
        ];

        for (min_mhz, max_mhz) in edge_cases {
            let capture_request = CaptureRequest {
                job_id: format!("test-edge-{}-{}", min_mhz, max_mhz),
                fragments: vec![
                    CaptureFragment {
                        min_freq_mhz: min_mhz,
                        max_freq_mhz: max_mhz,
                    }
                ],
                duration_s: 1.0,
                file_type: ".napt".to_string(),
                acquisition_mode: "stepwise".to_string(),
                encrypted: false,
                fft_size: 1024,
                fft_window: "Rectangular".to_string(),
                geolocation: None,
            };

            let result = processor.start_capture(capture_request);
            
            if min_mhz >= 24.0 && max_mhz <= 1766.0 && (max_mhz - min_mhz) <= 3.2 {
                // Should succeed for valid edge cases
                assert!(result.is_ok());
                
                sleep(Duration::from_millis(50)).await;
                
                let capture_result = processor.check_capture_completion()?;
                assert!(capture_result.channels[0].center_freq_hz > 0.0);
                
                processor.stop_capture()?;
            } else {
                // Should fail for invalid edge cases
                assert!(result.is_err());
            }
        }

        Ok(())
    }

    #[tokio::test]
    async fn test_frequency_overlap_detection() -> Result<()> {
        let mut processor = SdrProcessor::new_mock_apt()?;
        processor.initialize()?;

        // Try overlapping frequency ranges
        let capture_request = CaptureRequest {
            job_id: "test-overlap".to_string(),
            fragments: vec![
                CaptureFragment {
                    min_freq_mhz: 100.0,
                    max_freq_mhz: 102.0,
                },
                CaptureFragment {
                    min_freq_mhz: 101.0, // Overlaps with first fragment
                    max_freq_mhz: 103.0,
                }
            ],
            duration_s: 1.0,
            file_type: ".napt".to_string(),
            acquisition_mode: "stepwise".to_string(),
            encrypted: false,
            fft_size: 1024,
            fft_window: "Rectangular".to_string(),
            geolocation: None,
        };

        let result = processor.start_capture(capture_request);
        
        // Should either reject overlaps or handle them gracefully
        match result {
            Ok(_) => {
                // If it succeeds, verify no duplicate capture
                sleep(Duration::from_millis(100)).await;
                let capture_result = processor.check_capture_completion()?;
                
                // Should have 2 separate channels or merged into 1
                assert!(capture_result.channels.len() >= 1);
                assert!(capture_result.channels.len() <= 2);
                
                for channel in &capture_result.channels {
                    assert!(channel.center_freq_hz > 0.0);
                }
                
                processor.stop_capture()?;
            }
            Err(e) => {
                // It's acceptable to reject overlapping ranges
                assert!(e.to_string().contains("overlap") || 
                       e.to_string().contains("duplicate"));
            }
        }

        Ok(())
    }
}
