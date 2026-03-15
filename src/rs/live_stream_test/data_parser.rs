//! Binary message parsing for WebSocket data stream

use anyhow::{anyhow, Result};
use byteorder::{LittleEndian, ReadBytesExt};
use std::io::Cursor;

use super::decryption::derive_key;
use super::types::LiveData;

/// Parse binary WebSocket message and decrypt payload
/// 
/// Message format: [timestamp:8][center_freq:8][data_type:4][sample_rate:4][encrypted_payload]
pub fn parse_binary_message(passkey: &str, binary_data: &[u8]) -> Result<LiveData> {
    if binary_data.len() < 24 {
        return Err(anyhow!("Binary data too short: {} bytes", binary_data.len()));
    }

    let mut cursor = Cursor::new(binary_data);
    
    // Read header
    let timestamp = cursor.read_i64::<LittleEndian>()?;
    let center_frequency_hz_raw = cursor.read_u64::<LittleEndian>()?;
    let center_frequency_hz = center_frequency_hz_raw as u32;
    let data_type = cursor.read_u32::<LittleEndian>()?;
    let sample_rate_hz = cursor.read_u32::<LittleEndian>()?;
    
    // Remaining bytes are encrypted payload
    let encrypted_payload = &binary_data[24..];
    
    // Derive decryption key
    let key = derive_key(passkey);
    
    match data_type {
        0 => {
            // Spectrum data (FFT power values)
            let waveform = super::decryption::decrypt_waveform(&key, encrypted_payload)?;
            Ok(LiveData::Spectrum {
                timestamp,
                center_frequency_hz,
                sample_rate_hz,
                waveform,
            })
        }
        1 => {
            // Raw I/Q data
            let iq_bytes = super::decryption::decrypt_iq_data(&key, encrypted_payload)?;
            Ok(LiveData::RawIQ {
                timestamp,
                center_frequency_hz,
                sample_rate_hz,
                iq_bytes,
            })
        }
        _ => Err(anyhow!("Unknown data type: {}", data_type)),
    }
}

/// Calculate frequency for a given FFT bin index
pub fn bin_to_frequency(bin_index: usize, sample_rate_hz: u32, fft_size: usize) -> f64 {
    if bin_index <= fft_size / 2 {
        // Positive frequencies: 0 to Nyquist
        (bin_index as f64 / fft_size as f64) * sample_rate_hz as f64
    } else {
        // Negative frequencies: -Nyquist to 0
        -((fft_size - bin_index) as f64 / fft_size as f64) * sample_rate_hz as f64
    }
}

/// Convert power value to dB scale
pub fn power_to_db(power: f32) -> f32 {
    if power <= 0.0 {
        -120.0 // Floor value for very low power
    } else {
        10.0 * (power).log10()
    }
}

/// Find peaks in spectrum data
pub fn find_peaks(waveform: &[f32], sample_rate_hz: u32, threshold_db: f32, min_distance_bins: usize) -> Vec<(usize, f64, f32)> {
    let mut peaks = Vec::new();
    
    if waveform.is_empty() {
        return peaks;
    }
    
    let fft_size = waveform.len();
    
    for i in 0..fft_size {
        let power_db = power_to_db(waveform[i]);
        
        // Check if this point is above threshold
        if power_db < threshold_db {
            continue;
        }
        
        // Check if this is a local maximum
        let is_peak = if i == 0 {
            waveform[i] > waveform[1]
        } else if i == fft_size - 1 {
            waveform[i] > waveform[i - 1]
        } else {
            waveform[i] > waveform[i - 1] && waveform[i] > waveform[i + 1]
        };
        
        if !is_peak {
            continue;
        }
        
        // Check minimum distance from other peaks
        let too_close = peaks.iter().any(|&(prev_idx, _, _)| {
            (prev_idx as i64 - i as i64).abs() < min_distance_bins as i64
        });
        
        if too_close {
            continue;
        }
        
        let frequency_hz = bin_to_frequency(i, sample_rate_hz, fft_size);
        peaks.push((i, frequency_hz, power_db));
    }
    
    // Sort by power (strongest first)
    peaks.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap());
    
    peaks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bin_to_frequency() {
        let sample_rate = 1000000; // 1 MHz
        let fft_size = 1024;
        
        // DC bin
        assert_eq!(bin_to_frequency(0, sample_rate, fft_size), 0.0);
        
        // Nyquist bin
        assert_eq!(bin_to_frequency(fft_size / 2, sample_rate, fft_size), sample_rate as f64 / 2.0);
        
        // Positive frequency
        let freq = bin_to_frequency(256, sample_rate, fft_size);
        assert!(freq > 0.0 && freq < sample_rate as f64 / 2.0);
    }

    #[test]
    fn test_power_to_db() {
        assert_eq!(power_to_db(1.0), 0.0);
        assert_eq!(power_to_db(10.0), 10.0);
        assert_eq!(power_to_db(100.0), 20.0);
        assert_eq!(power_to_db(0.0), -120.0);
        assert_eq!(power_to_db(-1.0), -120.0);
    }

    #[test]
    fn test_find_peaks() {
        let mut waveform = vec![0.1; 1024];
        
        // Add some peaks
        waveform[100] = 10.0; // Strong peak
        waveform[101] = 5.0;
        waveform[102] = 0.1;
        
        waveform[500] = 8.0; // Another peak
        waveform[501] = 4.0;
        waveform[502] = 0.1;
        
        let peaks = find_peaks(&waveform, 1000000, -50.0, 10);
        
        assert_eq!(peaks.len(), 2);
        assert_eq!(peaks[0].0, 100); // Strongest peak first
        assert_eq!(peaks[1].0, 500);
        
        // Check frequency calculation
        let freq_100 = bin_to_frequency(100, 1000000, 1024);
        assert!((peaks[0].1 - freq_100).abs() < 0.001);
    }
}
