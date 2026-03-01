use n_apt_backend::sdr::SdrDevice;
use n_apt_backend::sdr::mock_apt::MockAptDevice;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_device_type() {
        let device = MockAptDevice::new();
        assert_eq!(device.device_type(), "mock_apt");
    }

    #[test]
    fn test_is_ready() {
        let device = MockAptDevice::new();
        assert!(device.is_ready(), "Mock device should always be ready");
    }

    #[test]
    fn test_initialize() {
        let mut device = MockAptDevice::new();
        let result = device.initialize();
        assert!(result.is_ok(), "initialize() should succeed");
        assert!(device.is_ready());
    }

    #[test]
    fn test_default_center_frequency() {
        let device = MockAptDevice::new();
        assert_eq!(device.get_center_frequency(), 1_600_000, "Default center freq should be 1.6 MHz");
    }

    #[test]
    fn test_default_sample_rate() {
        let device = MockAptDevice::new();
        assert_eq!(device.get_sample_rate(), 3_200_000, "Default sample rate should be 3.2 MSPS");
    }

    #[test]
    fn test_set_center_frequency_roundtrip() {
        let mut device = MockAptDevice::new();
        device.set_center_frequency(28_000_000).unwrap();
        assert_eq!(device.get_center_frequency(), 28_000_000);
    }

    #[test]
    fn test_set_gain() {
        let mut device = MockAptDevice::new();
        let result = device.set_gain(25.0);
        assert!(result.is_ok());
    }

    #[test]
    fn test_set_ppm() {
        let mut device = MockAptDevice::new();
        let result = device.set_ppm(5);
        assert!(result.is_ok());
    }

    #[test]
    fn test_set_tuner_agc() {
        let mut device = MockAptDevice::new();
        assert!(device.set_tuner_agc(true).is_ok());
        assert!(device.set_tuner_agc(false).is_ok());
    }

    #[test]
    fn test_set_rtl_agc() {
        let mut device = MockAptDevice::new();
        assert!(device.set_rtl_agc(true).is_ok());
        assert!(device.set_rtl_agc(false).is_ok());
    }

    #[test]
    fn test_read_samples_length() {
        let mut device = MockAptDevice::new();
        let fft_size = 1024;
        let result = device.read_samples(fft_size);
        assert!(result.is_ok(), "read_samples should succeed");
        let samples = result.unwrap();
        assert_eq!(
            samples.data.len(),
            fft_size * 2,
            "Output should be fft_size * 2 bytes (I/Q pairs)"
        );
    }

    #[test]
    fn test_read_samples_values_in_range() {
        let mut device = MockAptDevice::new();
        let samples = device.read_samples(512).unwrap();
        // All u8 values are inherently 0..=255, but verify none are missing
        assert!(samples.data.len() > 0);
        // Verify the sample_rate is passed through
        assert_eq!(samples.sample_rate, device.get_sample_rate());
    }

    #[test]
    fn test_read_samples_varies_between_frames() {
        let mut device = MockAptDevice::new();
        let frame1 = device.read_samples(256).unwrap();
        let frame2 = device.read_samples(256).unwrap();
        // Two consecutive frames should not be byte-identical
        // (noise and signal drift make this extremely unlikely)
        assert_ne!(frame1.data, frame2.data, "Consecutive frames should differ");
    }

    #[test]
    fn test_read_samples_different_fft_sizes() {
        let mut device = MockAptDevice::new();
        for &size in &[128, 256, 1024, 4096] {
            let result = device.read_samples(size);
            assert!(result.is_ok(), "read_samples should work for fft_size={}", size);
            assert_eq!(result.unwrap().data.len(), size * 2);
        }
    }

    #[test]
    fn test_reset_buffer() {
        let mut device = MockAptDevice::new();
        let result = device.reset_buffer();
        assert!(result.is_ok());
    }

    #[test]
    fn test_cleanup() {
        let mut device = MockAptDevice::new();
        let result = device.cleanup();
        assert!(result.is_ok());
    }
}
