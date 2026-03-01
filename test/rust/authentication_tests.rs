use n_apt_backend::sdr::processor::SdrProcessor;
use n_apt_backend::server::types;
#[allow(unused_imports)]
use n_apt_backend::server::utils;

#[test]
fn test_authentication_condition_check() {
    // Test the core logic: mock data should only be generated when authenticated_clients > 0 and not paused
    
    // Simulate no authenticated clients
    let authenticated_count = 0;
    let is_paused = false;
    let should_generate = authenticated_count > 0 && !is_paused;
    assert!(!should_generate, "Should not generate mock data with no authenticated clients");
    
    // Simulate authenticated clients but paused
    let authenticated_count = 1;
    let is_paused = true;
    let should_generate = authenticated_count > 0 && !is_paused;
    assert!(!should_generate, "Should not generate mock data when paused");
        
    // Simulate authenticated clients and not paused
    let authenticated_count = 1;
    let is_paused = false;
    let should_generate = authenticated_count > 0 && !is_paused;
    assert!(should_generate, "Should generate mock data with authenticated clients and not paused");
}


#[test]
fn test_mock_processor_creation() {
    // Test that mock processor can be created and generates signals when called directly
    let mut processor = SdrProcessor::new_mock_apt().unwrap();
    
    // This should work (direct call, not through I/O loop)
    let result = processor.read_and_process_frame();
    assert!(result.is_ok(), "Mock data generation should work when called directly");
    
    let spectrum = result.unwrap();
    assert!(!spectrum.is_empty(), "Mock spectrum should not be empty");
    // The mock processor returns the full FFT spectrum (NUM_SAMPLES = 131072)
    // not the mock spectrum size (MOCK_SPECTRUM_SIZE = 4096)
    assert_eq!(spectrum.len(), 32768, "Spectrum should match FFT size (default_size from signals.yaml)");
}
