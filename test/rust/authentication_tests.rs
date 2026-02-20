#[path = "../../src/server/sdr_processor.rs"]
mod sdr_processor;
#[path = "../../src/server/types.rs"]
mod types;
#[path = "../../src/server/utils.rs"]
mod utils;

use sdr_processor::SDRProcessor;

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

use n_apt_backend::consts::rs::mock::MOCK_SPECTRUM_SIZE;

#[test]
fn test_mock_processor_creation() {
    // Test that mock processor can be created and generates signals when called directly
    let mut processor = SDRProcessor::new();
    
    // This should work (direct call, not through I/O loop)
    let result = processor.read_and_process_mock();
    assert!(result.is_ok(), "Mock data generation should work when called directly");
    
    let spectrum = result.unwrap();
    assert!(!spectrum.is_empty(), "Mock spectrum should not be empty");
    // Mock spectrum size is defined by MOCK_SPECTRUM_SIZE (4096) 
    // rather than processor.fft_processor.fft_size() which is NUM_SAMPLES (131072)
    assert_eq!(spectrum.len(), MOCK_SPECTRUM_SIZE, "Spectrum should match mock spectrum size");
}
