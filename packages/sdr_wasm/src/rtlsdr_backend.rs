use rtl_sdr::{RTLSDRDevice, RTLSDRError};
use wasm_bindgen::prelude::*;
use rustfft::{FftPlanner, num_complex::Complex};
use js_sys::Float32Array;
use std::sync::{Arc, Mutex};

#[wasm_bindgen]
pub struct RTLSDRBackend {
    device: Option<Arc<Mutex<RTLSDRDevice>>>,
    fft_size: usize,
    sample_rate: u32,
    center_freq: u32,
    gain: i32,
    ppm: i32,
    fft: std::sync::Arc<dyn rustfft::Fft<f32>>,
}

#[wasm_bindgen]
pub struct RTLSDRResult {
    pub success: bool,
    pub error_message: Option<String>,
}

#[wasm_bindgen]
impl RTLSDRBackend {
    #[wasm_bindgen(constructor)]
    pub fn new() -> RTLSDRBackend {
        let mut planner = FftPlanner::<f32>::new();
        let fft_size = 32768; // Same as Python backend
        let fft = planner.plan_fft_forward(fft_size);
        
        RTLSDRBackend {
            device: None,
            fft_size,
            sample_rate: 3_200_000, // 3.2 MHz
            center_freq: 1_600_000,  // 1.6 MHz
            gain: 49,
            ppm: 1,
            fft,
        }
    }

    /// Initialize RTL-SDR device
    pub fn initialize(&mut self) -> RTLSDRResult {
        match RTLSDRDevice::open(0) {
            Ok(dev) => {
                let device = Arc::new(Mutex::new(dev));
                
                // Configure device
                {
                    let mut dev = device.lock().unwrap();
                    if let Err(e) = dev.set_sample_rate(self.sample_rate) {
                        return RTLSDRResult {
                            success: false,
                            error_message: Some(format!("Failed to set sample rate: {}", e)),
                        };
                    }
                    
                    if let Err(e) = dev.set_center_freq(self.center_freq) {
                        return RTLSDRResult {
                            success: false,
                            error_message: Some(format!("Failed to set center frequency: {}", e)),
                        };
                    }
                    
                    if let Err(e) = dev.set_gain(self.gain) {
                        return RTLSDRResult {
                            success: false,
                            error_message: Some(format!("Failed to set gain: {}", e)),
                        };
                    }
                    
                    if let Err(e) = dev.set_freq_correction(self.ppm) {
                        return RTLSDRResult {
                            success: false,
                            error_message: Some(format!("Failed to set PPM correction: {}", e)),
                        };
                    }
                    
                    if let Err(e) = dev.reset_buffer() {
                        return RTLSDRResult {
                            success: false,
                            error_message: Some(format!("Failed to reset buffer: {}", e)),
                        };
                    }
                }
                
                self.device = Some(device);
                RTLSDRResult {
                    success: true,
                    error_message: None,
                }
            }
            Err(e) => RTLSDRResult {
                success: false,
                error_message: Some(format!("Failed to open RTL-SDR device: {}", e)),
            },
        }
    }

    /// Check if device is initialized
    pub fn is_initialized(&self) -> bool {
        self.device.is_some()
    }

    /// Set center frequency
    pub fn set_center_frequency(&mut self, freq: u32) -> RTLSDRResult {
        self.center_freq = freq;
        if let Some(device) = &self.device {
            match device.lock().unwrap().set_center_freq(freq) {
                Ok(_) => RTLSDRResult {
                    success: true,
                    error_message: None,
                },
                Err(e) => RTLSDRResult {
                    success: false,
                    error_message: Some(format!("Failed to set center frequency: {}", e)),
                },
            }
        } else {
            RTLSDRResult {
                success: false,
                error_message: Some("Device not initialized".to_string()),
            }
        }
    }

    /// Set sample rate
    pub fn set_sample_rate(&mut self, rate: u32) -> RTLSDRResult {
        self.sample_rate = rate;
        if let Some(device) = &self.device {
            match device.lock().unwrap().set_sample_rate(rate) {
                Ok(_) => RTLSDRResult {
                    success: true,
                    error_message: None,
                },
                Err(e) => RTLSDRResult {
                    success: false,
                    error_message: Some(format!("Failed to set sample rate: {}", e)),
                },
            }
        } else {
            RTLSDRResult {
                success: false,
                error_message: Some("Device not initialized".to_string()),
            }
        }
    }

    /// Set gain
    pub fn set_gain(&mut self, gain: i32) -> RTLSDRResult {
        self.gain = gain;
        if let Some(device) = &self.device {
            match device.lock().unwrap().set_gain(gain) {
                Ok(_) => RTLSDRResult {
                    success: true,
                    error_message: None,
                },
                Err(e) => RTLSDRResult {
                    success: false,
                    error_message: Some(format!("Failed to set gain: {}", e)),
                },
            }
        } else {
            RTLSDRResult {
                success: false,
                error_message: Some("Device not initialized".to_string()),
            }
        }
    }

    /// Set PPM correction
    pub fn set_ppm(&mut self, ppm: i32) -> RTLSDRResult {
        self.ppm = ppm;
        if let Some(device) = &self.device {
            match device.lock().unwrap().set_freq_correction(ppm) {
                Ok(_) => RTLSDRResult {
                    success: true,
                    error_message: None,
                },
                Err(e) => RTLSDRResult {
                    success: false,
                    error_message: Some(format!("Failed to set PPM correction: {}", e)),
                },
            }
        } else {
            RTLSDRResult {
                success: false,
                error_message: Some("Device not initialized".to_string()),
            }
        }
    }

    /// Read samples and process FFT
    pub fn read_and_process(&mut self) -> Result<Float32Array, JsValue> {
        if let Some(device) = &self.device {
            let mut dev = device.lock().unwrap();
            
            // Read samples
            let samples = match dev.read_sync(self.fft_size * 2) {
                Ok(samples) => samples,
                Err(e) => return Err(JsValue::from_str(&format!("Failed to read samples: {}", e))),
            };

            // Convert to complex numbers and apply PPM correction
            let mut buf: Vec<Complex<f32>> = Vec::with_capacity(self.fft_size);
            let gain_f32 = self.gain as f32;
            let ppm_f32 = self.ppm as f32;

            for i in 0..self.fft_size {
                let idx = i * 2;
                if idx + 1 < samples.len() {
                    let i_sample = (samples[idx] as f32 / 255.0 - 0.5) * 2.0 * gain_f32;
                    let q_sample = (samples[idx + 1] as f32 / 255.0 - 0.5) * 2.0 * gain_f32;

                    // Apply PPM correction
                    let phase = 2.0 * std::f32::consts::PI * ppm_f32 * i as f32 / self.fft_size as f32;
                    let rot = Complex::from_polar(1.0, phase);

                    buf.push(Complex::new(i_sample, q_sample) * rot);
                } else {
                    buf.push(Complex::new(0.0, 0.0));
                }
            }

            // Perform FFT
            self.fft.process(&mut buf);

            // Calculate power spectrum (log scale)
            let mut power = Vec::with_capacity(self.fft_size);
            for c in buf {
                let mag = c.norm_sqr();
                power.push(10.0 * mag.log10().max(-120.0));
            }

            Ok(Float32Array::from(&power[..]))
        } else {
            Err(JsValue::from_str("Device not initialized"))
        }
    }

    /// Get device info
    pub fn get_device_info(&self) -> String {
        if let Some(device) = &self.device {
            let dev = device.lock().unwrap();
            format!(
                "RTL-SDR Device - Sample Rate: {} Hz, Center Freq: {} Hz, Gain: {} dB, PPM: {}",
                self.sample_rate, self.center_freq, self.gain, self.ppm
            )
        } else {
            "Device not initialized".to_string()
        }
    }

    /// Close device
    pub fn close(&mut self) {
        self.device = None;
    }
}

// Mock implementation for when RTL-SDR is not available
#[wasm_bindgen]
pub struct MockRTLSDRBackend {
    fft_size: usize,
    sample_rate: u32,
    center_freq: u32,
    gain: i32,
    ppm: i32,
    fft: std::sync::Arc<dyn rustfft::Fft<f32>>,
    time: f32,
}

#[wasm_bindgen]
impl MockRTLSDRBackend {
    #[wasm_bindgen(constructor)]
    pub fn new() -> MockRTLSDRBackend {
        let mut planner = FftPlanner::<f32>::new();
        let fft_size = 32768;
        let fft = planner.plan_fft_forward(fft_size);
        
        MockRTLSDRBackend {
            fft_size,
            sample_rate: 3_200_000,
            center_freq: 1_600_000,
            gain: 49,
            ppm: 1,
            fft,
            time: 0.0,
        }
    }

    pub fn read_and_process(&mut self) -> Float32Array {
        // Generate mock signal data
        let mut buf: Vec<Complex<f32>> = Vec::with_capacity(self.fft_size);
        
        for i in 0..self.fft_size {
            let t = self.time + i as f32 / self.sample_rate as f32;
            
            // Generate mock signal with multiple frequency components
            let signal = 
                (2.0 * std::f32::consts::PI * 1000.0 * t).sin() * 0.3 +  // 1 kHz
                (2.0 * std::f32::consts::PI * 5000.0 * t).sin() * 0.2 +  // 5 kHz
                (2.0 * std::f32::consts::PI * 10000.0 * t).sin() * 0.1 + // 10 kHz
                (rand::random::<f32>() - 0.5) * 0.1; // Noise
            
            buf.push(Complex::new(signal, signal * 0.5));
        }
        
        self.time += self.fft_size as f32 / self.sample_rate as f32;
        
        // Perform FFT
        self.fft.process(&mut buf);
        
        // Calculate power spectrum
        let mut power = Vec::with_capacity(self.fft_size);
        for c in buf {
            let mag = c.norm_sqr();
            power.push(10.0 * mag.log10().max(-120.0));
        }
        
        Float32Array::from(&power[..])
    }
}
