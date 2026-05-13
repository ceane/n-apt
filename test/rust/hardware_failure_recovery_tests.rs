use anyhow::Result;
use n_apt_backend::sdr::processor::SdrProcessor;
use n_apt_backend::server::types::CaptureRequest;
use std::time::Duration;
use tokio::time::sleep;

#[cfg(test)]
mod failure_tests {
    use super::*;

    #[tokio::test]
    async fn test_capture_recovery_on_hardware_malfunction() -> Result<()> {
        let mut processor = SdrProcessor::new_mock_apt()?;
        processor.initialize()?;

        // 1. Start a long-duration capture (10 seconds)
        let capture_request = CaptureRequest {
            job_id: "failure-test-job".to_string(),
            fragments: vec![n_apt_backend::server::types::CaptureFragment {
                min_freq_mhz: 100.0,
                max_freq_mhz: 103.2,
            }],
            duration_s: 10.0,
            duration_mode: "timed".to_string(),
            file_type: ".napt".to_string(),
            acquisition_mode: "stepwise".to_string(),
            encrypted: false,
            fft_size: 1024,
            fft_window: "Rectangular".to_string(),
            geolocation: None,
            bandwidth: None,
            bandwidth_center_frequency: None,
        };

        processor.start_capture(capture_request)?;
        
        // 2. Process some frames to accumulate data
        // In the real app, this happens in the main WebSocket loop.
        for _ in 0..10 {
            let _ = processor.read_and_process_frame()?;
            sleep(Duration::from_millis(50)).await;
        }

        assert!(processor.capture_active);

        // 3. Simulate hardware failure by manually stopping the capture
        // In the real app, run_health_check would detect the failure and call stop_capture.
        // We verify that stop_capture returns a valid partial result.
        let capture_result = processor.stop_capture().expect("Should return partial result even on failure");

        // 4. Verify the result is partial
        assert_eq!(capture_result.job_id, "failure-test-job");
        
        // Ensure at least some data was captured
        let total_iq_size: usize = capture_result.channels.iter().map(|c| c.iq_data.len()).sum();
        let total_spectrum_size: usize = capture_result.channels.iter().map(|c| c.spectrum_data.len()).sum();
        
        assert!(total_iq_size > 0, "Total IQ data should not be empty");
        assert!(total_spectrum_size > 0, "Total spectrum data should not be empty");
        
        // Also verify duration is reasonable
        assert!(capture_result.duration_s < 9.0, "Duration should be significantly less than the requested 10s");
        assert!(capture_result.duration_s > 0.01, "Duration should be positive");

        Ok(())
    }
}
