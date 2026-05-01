//! End-to-end frequency scaling validation
//!
//! Verifies that frequencies defined in signals.yaml (using !frequency and !frequency_range tags)
//! are correctly normalized to raw Hz when loaded by the backend.

use n_apt_backend::server::utils::load_channels;

#[test]
fn test_signals_yaml_normalization_e2e() {
    // This integration test loads the actual signals.yaml (or the one in the workspace)
    // and verifies that the normalization logic converts all units to raw Hz.
    let channels = load_channels();
    
    assert!(!channels.is_empty(), "Expected at least one channel to be defined in signals.yaml");
    
    for ch in channels {
        println!("Checking channel {}: {} Hz to {} Hz", ch.id, ch.min_hz, ch.max_hz);
        
        // Frequencies in signals.yaml are typically in the kHz or MHz range.
        // If they were still in MHz, 137.5MHz would be 137.5.
        // If normalized to Hz, it should be 137,500,000.
        // We assert that the values are > 1000.0 (since the lowest freq is 18kHz = 18,000).
        assert!(
            ch.min_hz >= 1000.0, 
            "Channel {} has frequency {} which seems too low. Expected Hz, might be MHz legacy unit.", 
            ch.id, ch.min_hz
        );
        
        assert!(
            ch.max_hz > ch.min_hz,
            "Channel {} has invalid range: [{}, {}]",
            ch.id, ch.min_hz, ch.max_hz
        );
    }
}
