import re

with open('src/rs/server/websocket_server/mock_tx.rs', 'r') as f:
    content = f.read()

target = """
use std::sync::Mutex;

#[derive(Clone, PartialEq, Debug)]
struct MockTxParams {
  signal_key: String,
  tx_sample_rate_hz: f64,
  tx_center_hz: f64,
  power_dbm: f64,
  sample_rate_hz: f64,
  view_center_hz: f64,
  tx_ifft_size: usize,
}

struct MockTxBuffer {
  params: Option<MockTxParams>,
  samples: Vec<Complex<f32>>,
}

impl MockTxBuffer {
  const fn new() -> Self {
    Self {
      params: None,
      samples: Vec::new(),
    }
  }
}

static MOCK_TX_CACHE: Mutex<MockTxBuffer> = Mutex::new(MockTxBuffer::new());

fn generate_mock_tx_samples_ifft(params: &MockTxParams, target_rms: f64) -> Vec<Complex<f32>> {
  let mut planner = FftPlanner::<f32>::new();
  let fft = planner.plan_fft_inverse(params.tx_ifft_size);
  let mut spectrum = vec![Complex::new(0.0_f32, 0.0_f32); params.tx_ifft_size];

  let half_view = params.sample_rate_hz / 2.0;
  let half_tx = params.tx_sample_rate_hz / 2.0;
  let view_min_hz = params.view_center_hz - half_view;
  let view_max_hz = params.view_center_hz + half_view;
  let tx_min_hz = params.tx_center_hz - half_tx;
  let tx_max_hz = params.tx_center_hz + half_tx;
  
  if view_max_hz >= tx_min_hz && view_min_hz <= tx_max_hz {
    let (_offset_hz, _tone_hz, bandwidth_hz) =
      resolve_mock_tx_monitor_params(&params.signal_key, params.tx_sample_rate_hz);
      
    let tx_occupied_bandwidth_hz =
      params.tx_sample_rate_hz.min(params.sample_rate_hz).max(1.0);
      
    let effective_bandwidth_hz =
      bandwidth_hz.min(tx_occupied_bandwidth_hz * 0.85).max(1.0);
      
    let rel_hz = params.tx_center_hz - params.view_center_hz;
    
    if rel_hz.abs() <= half_view * 0.98 {
      let hz_per_bin = params.sample_rate_hz / params.tx_ifft_size as f64;
      let start_hz = rel_hz - effective_bandwidth_hz / 2.0;
      let end_hz = rel_hz + effective_bandwidth_hz / 2.0;
      
      let start_bin = (start_hz / hz_per_bin).round() as isize;
      let end_bin = (end_hz / hz_per_bin).round() as isize;
      
      let num_bins = (end_bin - start_bin).max(1) as usize;
      
      for k in 0..num_bins {
        let bin_idx = start_bin + k as isize;
        let wrapped_bin = if bin_idx < 0 {
          (params.tx_ifft_size as isize + bin_idx) as usize
        } else {
          bin_idx as usize
        };
        
        if wrapped_bin < params.tx_ifft_size {
          let phase = std::f64::consts::PI * (k as f64).powi(2) / num_bins as f64;
          let (sin_p, cos_p) = phase.sin_cos();
          spectrum[wrapped_bin] = Complex::new(
            (cos_p * target_rms) as f32, 
            (sin_p * target_rms) as f32
          );
        }
      }
    }
  }
  
  fft.process(&mut spectrum);
  
  let mut max_peak = 0.0_f32;
  for s in &spectrum {
    let peak = s.re.abs().max(s.im.abs());
    if peak > max_peak { max_peak = peak; }
  }
  if max_peak > 1.0 {
    let scale = 0.95 / max_peak;
    for s in &mut spectrum {
       s.re *= scale;
       s.im *= scale;
    }
  }
  
  spectrum
}

pub fn synthesize_mock_tx_monitor_iq(
  fft_size: usize,
  view_center_hz: f64,
  view_sample_rate: u32,
  tx_center_hz: f64,
  tx_sample_rate_hz: f64,
  signal_name: &str,
  tx_ifft_size: usize,
  power_dbm: f64,
  power_model: &TxIqPowerModel,
  _phase_accumulator: &mut f64,
) -> Vec<u8> {
  if fft_size == 0 {
    return Vec::new();
  }

  let sample_rate_hz = view_sample_rate.max(1) as f64;
  let tx_sample_rate_hz = tx_sample_rate_hz.max(1.0);
  let signal_key = if signal_name.trim().is_empty() {
    "apt".to_string()
  } else {
    signal_name.trim().to_ascii_lowercase()
  };

  let quantized_power_floor_dbm =
    crate::safety::get_quantized_iq_power_floor_dbm(
      8,
      tx_ifft_size.max(1) as u32,
      power_model.calibration_db,
    )
    .ceil();
  let target_rms = mock_tx_monitor_target_rms_from_dbm(
    power_dbm.max(quantized_power_floor_dbm),
    power_model,
  );
  let noise_floor_rms = mock_tx_monitor_noise_floor_rms(power_model);
  
  let current_params = MockTxParams {
    signal_key,
    tx_sample_rate_hz,
    tx_center_hz,
    power_dbm: power_dbm.max(quantized_power_floor_dbm),
    sample_rate_hz,
    view_center_hz,
    tx_ifft_size,
  };

  let start_sample =
    MOCK_TX_MONITOR_SAMPLE_CURSOR.fetch_add(fft_size as u64, Ordering::Relaxed);

  // Read or compute cached IFFT block
  let mut cache = MOCK_TX_CACHE.lock().unwrap();
  if cache.params.as_ref() != Some(&current_params) || cache.samples.is_empty() || cache.samples.len() != tx_ifft_size {
    cache.samples = generate_mock_tx_samples_ifft(&current_params, target_rms);
    cache.params = Some(current_params);
  }
  let block = cache.samples.clone();
  drop(cache);

  let mut out = Vec::with_capacity(fft_size * 2);
  for j in 0..fft_size {
    let t = start_sample + j as u64;
    let block_sample = block[(t % tx_ifft_size as u64) as usize];
    
    let noise_i = mock_tx_noise_unit(t, 0x464c_4154_5458_4949) * noise_floor_rms;
    let noise_q = mock_tx_noise_unit(t, 0x464c_4154_5458_5151) * noise_floor_rms;
    
    let i_val = block_sample.re as f64 + noise_i;
    let q_val = block_sample.im as f64 + noise_q;
    
    out.push(quantize_mock_tx_iq(i_val, t, 0x544d_4f4e_4951_4949));
    out.push(quantize_mock_tx_iq(q_val, t, 0x544d_4f4e_4951_5151));
  }

  out
}
"""

start_str = "pub fn synthesize_mock_tx_monitor_iq("
end_str = "#[cfg(test)]"

start_idx = content.find(start_str)
end_idx = content.find(end_str)

if start_idx != -1 and end_idx != -1:
    new_content = content[:start_idx] + target + "\n" + content[end_idx:]
    with open('src/rs/server/websocket_server/mock_tx.rs', 'w') as f:
        f.write(new_content)
    print("Success!")
else:
    print("Failed to find bounds")
