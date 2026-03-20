//! Example algorithms for testing with live stream data

use std::collections::VecDeque;

use super::data_parser::{find_peaks, power_to_db};
use super::types::{AlgorithmResult, AlgorithmResultType, LiveData, PeakInfo};

/// Algorithm tester for running various signal processing algorithms
pub struct AlgorithmTester {
    results: Vec<AlgorithmResult>,
    spectrum_history: VecDeque<Vec<f32>>,
    max_history_size: usize,
    frame_count: u64,
}

impl AlgorithmTester {
    /// Create new algorithm tester
    pub fn new() -> Self {
        Self {
            results: Vec::new(),
            spectrum_history: VecDeque::new(),
            max_history_size: 100, // Keep last 100 frames
            frame_count: 0,
        }
    }

    /// Process live data and run algorithms
    pub fn process_data(&mut self, data: LiveData) {
        match data {
            LiveData::Spectrum { waveform, timestamp, center_frequency_hz, sample_rate_hz } => {
                self.frame_count += 1;
                
                // Store in history
                self.spectrum_history.push_back(waveform.clone());
                if self.spectrum_history.len() > self.max_history_size {
                    self.spectrum_history.pop_front();
                }

                // Run various algorithms
                self.run_peak_detection(&waveform, timestamp, center_frequency_hz, sample_rate_hz);
                self.run_signal_strength_analysis(&waveform, timestamp);
                self.run_frequency_analysis(&waveform, timestamp, center_frequency_hz, sample_rate_hz);
                self.run_noise_floor_analysis(&waveform, timestamp);
                
                // Print periodic updates
                if self.frame_count % 10 == 0 {
                    self.print_status();
                }
            }
            LiveData::RawIQ { iq_bytes, timestamp, center_frequency_hz, sample_rate_hz } => {
                self.process_iq_data(&iq_bytes, timestamp, center_frequency_hz, sample_rate_hz);
            }
        }
    }

    /// Run peak detection algorithm
    fn run_peak_detection(&mut self, waveform: &[f32], timestamp: i64, _center_freq_hz: u32, sample_rate_hz: u32) {
        let peaks = find_peaks(waveform, sample_rate_hz, -60.0, 5);
        
        let peak_infos: Vec<PeakInfo> = peaks.iter()
            .take(10) // Top 10 peaks
            .map(|(bin_idx, freq_hz, power_db)| PeakInfo {
                bin_index: *bin_idx,
                frequency_hz: *freq_hz,
                power_db: *power_db,
            })
            .collect();

        let result = AlgorithmResult {
            name: "Peak Detection".to_string(),
            timestamp,
            result_type: AlgorithmResultType::PeakDetection { peaks: peak_infos.clone() },
        };

        self.results.push(result);

        // Print significant peaks
        for (i, peak) in peak_infos.iter().take(3).enumerate() {
            if peak.power_db > -50.0 {
                println!("📡 Peak {}: {:.1} MHz, {:.1} dB", 
                    i + 1, peak.frequency_hz / 1e6, peak.power_db);
            }
        }
    }

    /// Run signal strength analysis
    fn run_signal_strength_analysis(&mut self, waveform: &[f32], timestamp: i64) {
        let power_db_values: Vec<f32> = waveform.iter()
            .map(|&power| power_to_db(power))
            .collect();

        let avg_power_db = power_db_values.iter().sum::<f32>() / power_db_values.len() as f32;
        let max_power_db = power_db_values.iter().fold(f32::NEG_INFINITY, |a, &b| a.max(b));
        let min_power_db = power_db_values.iter().fold(f32::INFINITY, |a, &b| a.min(b));

        let result = AlgorithmResult {
            name: "Signal Strength".to_string(),
            timestamp,
            result_type: AlgorithmResultType::SignalStrength {
                avg_power_db,
                max_power_db,
                min_power_db,
            },
        };

        self.results.push(result);
    }

    /// Run frequency domain analysis
    fn run_frequency_analysis(&mut self, waveform: &[f32], timestamp: i64, _center_freq_hz: u32, sample_rate_hz: u32) {
        if waveform.is_empty() {
            return;
        }

        // Find dominant frequency (peak with highest power)
        let peaks = find_peaks(waveform, sample_rate_hz, -120.0, 1);
        
        if let Some((_, dominant_freq_hz, _)) = peaks.first() {
            // Estimate bandwidth (3dB bandwidth around dominant peak)
            let dominant_bin = (*dominant_freq_hz / sample_rate_hz as f64 * waveform.len() as f64) as usize;
            let power_at_peak = power_to_db(waveform[dominant_bin]);
            let threshold_3db = power_at_peak - 3.0;

            let mut lower_bin = dominant_bin;
            let mut upper_bin = dominant_bin;

            // Find lower 3dB point
            while lower_bin > 0 && power_to_db(waveform[lower_bin]) > threshold_3db {
                lower_bin -= 1;
            }

            // Find upper 3dB point
            while upper_bin < waveform.len() - 1 && power_to_db(waveform[upper_bin]) > threshold_3db {
                upper_bin += 1;
            }

            let lower_freq = bin_to_frequency(lower_bin, sample_rate_hz, waveform.len());
            let upper_freq = bin_to_frequency(upper_bin, sample_rate_hz, waveform.len());
            let bandwidth_hz = upper_freq - lower_freq;

            let result = AlgorithmResult {
                name: "Frequency Analysis".to_string(),
                timestamp,
                result_type: AlgorithmResultType::FrequencyAnalysis {
                    dominant_freq_hz: *dominant_freq_hz,
                    bandwidth_hz,
                },
            };

            self.results.push(result);
        }
    }

    /// Run noise floor analysis
    fn run_noise_floor_analysis(&mut self, waveform: &[f32], _timestamp: i64) {
        let power_db_values: Vec<f32> = waveform.iter()
            .map(|&power| power_to_db(power))
            .collect();

        // Sort to find percentiles
        let mut sorted_powers = power_db_values.clone();
        sorted_powers.sort_by(|a, b| a.partial_cmp(b).unwrap());

        let noise_floor_10th = sorted_powers[sorted_powers.len() / 10]; // 10th percentile
        let noise_floor_median = sorted_powers[sorted_powers.len() / 2]; // 50th percentile

        println!("🔊 Noise Floor: {:.1} dB (10th percentile), {:.1} dB (median)", 
            noise_floor_10th, noise_floor_median);
    }

    /// Process raw I/Q data
    fn process_iq_data(&mut self, iq_bytes: &[u8], _timestamp: i64, center_freq_hz: u32, sample_rate_hz: u32) {
        println!("📊 Received I/Q data: {} bytes, center: {:.1} MHz, rate: {:.1} MHz", 
            iq_bytes.len(), center_freq_hz as f64 / 1e6, sample_rate_hz as f64 / 1e6);

        // Convert bytes to complex samples (assuming 8-bit I/Q interleaved)
        let num_samples = iq_bytes.len() / 2;
        if num_samples > 0 {
            let mut i_samples = Vec::with_capacity(num_samples);
            let mut q_samples = Vec::with_capacity(num_samples);

            for i in 0..num_samples {
                let i_val = iq_bytes[i * 2] as i8 as f32 / 128.0;
                let q_val = iq_bytes[i * 2 + 1] as i8 as f32 / 128.0;
                i_samples.push(i_val);
                q_samples.push(q_val);
            }

            // Calculate basic statistics
            let avg_i = i_samples.iter().sum::<f32>() / num_samples as f32;
            let avg_q = q_samples.iter().sum::<f32>() / num_samples as f32;
            
            let power: Vec<f32> = i_samples.iter().zip(q_samples.iter())
                .map(|(i, q)| i * i + q * q)
                .collect();
            let avg_power = power.iter().sum::<f32>() / num_samples as f32;

            println!("📈 I/Q Stats: I_avg={:.3}, Q_avg={:.3}, Power_avg={:.3}", 
                avg_i, avg_q, avg_power);
        }
    }

    /// Run built-in example algorithms
    pub fn run_example_algorithms(&mut self) {
        println!("🧪 Running example algorithms...");
        println!("📊 Processing live data stream...");
        println!("Press Ctrl+C to stop");
        println!("{}", "─".to_string().repeat(50));
    }

    /// Print current status
    fn print_status(&self) {
        println!("📊 Processed {} frames, {} results stored", 
            self.frame_count, self.results.len());
    }

    /// Get all results
    pub fn get_results(&self) -> &[AlgorithmResult] {
        &self.results
    }

    /// Clear all results
    pub fn clear_results(&mut self) {
        self.results.clear();
    }
}

/// Helper function to convert bin index to frequency
fn bin_to_frequency(bin_index: usize, sample_rate_hz: u32, fft_size: usize) -> f64 {
    if bin_index <= fft_size / 2 {
        // Positive frequencies: 0 to Nyquist
        (bin_index as f64 / fft_size as f64) * sample_rate_hz as f64
    } else {
        // Negative frequencies: -Nyquist to 0
        -((fft_size - bin_index) as f64 / fft_size as f64) * sample_rate_hz as f64
    }
}
