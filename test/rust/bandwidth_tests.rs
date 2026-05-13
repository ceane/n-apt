use n_apt_backend::sdr::processor::SdrProcessor;
use n_apt_backend::server::types::{CaptureFragment, CaptureRequest};
use anyhow::Result;

#[cfg(test)]
mod bandwidth_tests {
    use super::*;

    #[test]
    fn test_capture_request_with_bandwidth_override() -> Result<()> {
        let mut processor = SdrProcessor::new_mock_apt()?;
        processor.initialize()?;

        // Capture request with manual bandwidth override
        let request = CaptureRequest {
            job_id: "test-bandwidth-override".to_string(),
            fragments: vec![CaptureFragment {
                min_freq_mhz: 100.0,
                max_freq_mhz: 102.0,
            }],
            duration_s: 0.1,
            duration_mode: "timed".to_string(),
            file_type: ".napt".to_string(),
            acquisition_mode: "stepwise".to_string(),
            encrypted: false,
            fft_size: 1024,
            fft_window: "Hanning".to_string(),
            geolocation: None,
            bandwidth: Some(1_000_000), // 1MHz override
            bandwidth_center_frequency: Some(101_000_000),
        };

        // This just verifies the struct can be passed to start_capture
        let result = processor.start_capture(request);
        assert!(result.is_ok());

        processor.stop_capture();
        Ok(())
    }

    #[test]
    fn test_capture_request_without_bandwidth_override() -> Result<()> {
        let mut processor = SdrProcessor::new_mock_apt()?;
        processor.initialize()?;

        // Standard capture request without override
        let request = CaptureRequest {
            job_id: "test-no-bandwidth".to_string(),
            fragments: vec![CaptureFragment {
                min_freq_mhz: 100.0,
                max_freq_mhz: 102.0,
            }],
            duration_s: 0.1,
            duration_mode: "timed".to_string(),
            file_type: ".napt".to_string(),
            acquisition_mode: "stepwise".to_string(),
            encrypted: false,
            fft_size: 1024,
            fft_window: "Hanning".to_string(),
            geolocation: None,
            bandwidth: None,
            bandwidth_center_frequency: None,
        };

        let result = processor.start_capture(request);
        assert!(result.is_ok());

        processor.stop_capture();
        Ok(())
    }
}
