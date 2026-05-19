#![cfg(all(feature = "mock_apt_metal", target_os = "macos"))]

use anyhow::{anyhow, Result};
use metal::{
  CompileOptions, ComputePipelineState, Device, MTLResourceOptions, MTLSize,
};
use std::ptr;

const METAL_SHADER: &str = r#"
#include <metal_stdlib>
using namespace metal;

kernel void mock_apt_finalize(
  device const float *i_acc [[buffer(0)]],
  device const float *q_acc [[buffer(1)]],
  device const float *noise_i [[buffer(2)]],
  device const float *noise_q [[buffer(3)]],
  device uchar *out [[buffer(4)]],
  uint idx [[thread_position_in_grid]]
) {
  float i = clamp(i_acc[idx] + noise_i[idx], -1.0f, 1.0f);
  float q = clamp(q_acc[idx] + noise_q[idx], -1.0f, 1.0f);
  out[idx * 2] = uchar(((i * 127.0) + 128.0));
  out[idx * 2 + 1] = uchar(((q * 127.0) + 128.0));
}
"#;

pub struct MockAptMetalBackend {
  _device: Device,
  queue: metal::CommandQueue,
  pipeline_state: ComputePipelineState,
  i_buffer: metal::Buffer,
  q_buffer: metal::Buffer,
  noise_i_buffer: metal::Buffer,
  noise_q_buffer: metal::Buffer,
  output_buffer: metal::Buffer,
  buffer_capacity_samples: usize,
}

impl MockAptMetalBackend {
  pub fn validate() -> Result<()> {
    Self::new().map(|_| ())
  }

  pub fn new() -> Result<Self> {
    let device = Device::system_default()
      .ok_or_else(|| anyhow!("Metal system default device is unavailable"))?;
    let queue = device.new_command_queue();
    let options = CompileOptions::new();
    let library = device
      .new_library_with_source(METAL_SHADER, &options)
      .map_err(|error| anyhow!("failed to compile Metal shader: {error}"))?;
    let function = library
      .get_function("mock_apt_finalize", None)
      .map_err(|error| anyhow!("failed to get Metal kernel: {error}"))?;
    let pipeline_state = device
      .new_compute_pipeline_state_with_function(&function)
      .map_err(|error| anyhow!("failed to create Metal pipeline: {error}"))?;

    let buffer_capacity_samples = 1;
    let (
      i_buffer,
      q_buffer,
      noise_i_buffer,
      noise_q_buffer,
      output_buffer,
    ) = Self::allocate_buffers(&device, buffer_capacity_samples);

    Ok(Self {
      _device: device,
      queue,
      pipeline_state,
      i_buffer,
      q_buffer,
      noise_i_buffer,
      noise_q_buffer,
      output_buffer,
      buffer_capacity_samples,
    })
  }

  #[allow(dead_code)]
  pub fn is_available() -> bool {
    Device::system_default().is_some()
  }

  fn allocate_buffers(
    device: &Device,
    fft_size: usize,
  ) -> (
    metal::Buffer,
    metal::Buffer,
    metal::Buffer,
    metal::Buffer,
    metal::Buffer,
  ) {
    let sample_bytes = (fft_size * std::mem::size_of::<f32>()) as u64;
    let output_bytes = (fft_size * 2) as u64;
    let options = MTLResourceOptions::StorageModeShared;
    (
      device.new_buffer(sample_bytes, options),
      device.new_buffer(sample_bytes, options),
      device.new_buffer(sample_bytes, options),
      device.new_buffer(sample_bytes, options),
      device.new_buffer(output_bytes, options),
    )
  }

  fn ensure_capacity(&mut self, fft_size: usize) {
    if fft_size <= self.buffer_capacity_samples {
      return;
    }

    let (i_buffer, q_buffer, noise_i_buffer, noise_q_buffer, output_buffer) =
      Self::allocate_buffers(&self._device, fft_size);
    self.i_buffer = i_buffer;
    self.q_buffer = q_buffer;
    self.noise_i_buffer = noise_i_buffer;
    self.noise_q_buffer = noise_q_buffer;
    self.output_buffer = output_buffer;
    self.buffer_capacity_samples = fft_size;
  }

  fn copy_to_buffer(buffer: &metal::Buffer, source: &[f32]) {
    unsafe {
      ptr::copy_nonoverlapping(
        source.as_ptr(),
        buffer.contents() as *mut f32,
        source.len(),
      );
    }
  }

  pub fn finalize_frame(
    &mut self,
    i_accumulator: &[f32],
    q_accumulator: &[f32],
    noise_i: &[f32],
    noise_q: &[f32],
  ) -> Result<Vec<u8>> {
    if i_accumulator.len() != q_accumulator.len()
      || i_accumulator.len() != noise_i.len()
      || i_accumulator.len() != noise_q.len()
    {
      return Err(anyhow!("Metal finalize inputs must have identical lengths"));
    }

    let fft_size = i_accumulator.len();
    self.ensure_capacity(fft_size);

    Self::copy_to_buffer(&self.i_buffer, i_accumulator);
    Self::copy_to_buffer(&self.q_buffer, q_accumulator);
    Self::copy_to_buffer(&self.noise_i_buffer, noise_i);
    Self::copy_to_buffer(&self.noise_q_buffer, noise_q);

    let command_buffer = self.queue.new_command_buffer();
    let encoder = command_buffer.new_compute_command_encoder();
    encoder.set_compute_pipeline_state(&self.pipeline_state);
    encoder.set_buffer(0, Some(&self.i_buffer), 0);
    encoder.set_buffer(1, Some(&self.q_buffer), 0);
    encoder.set_buffer(2, Some(&self.noise_i_buffer), 0);
    encoder.set_buffer(3, Some(&self.noise_q_buffer), 0);
    encoder.set_buffer(4, Some(&self.output_buffer), 0);

    let threads_per_group = std::cmp::max(
      1,
      std::cmp::min(
        self.pipeline_state.thread_execution_width() as usize,
        self.pipeline_state.max_total_threads_per_threadgroup() as usize,
      ),
    );

    encoder.dispatch_threads(
      MTLSize {
        width: fft_size as u64,
        height: 1,
        depth: 1,
      },
      MTLSize {
        width: threads_per_group as u64,
        height: 1,
        depth: 1,
      },
    );
    encoder.end_encoding();
    command_buffer.commit();
    command_buffer.wait_until_completed();

    let mut data = vec![0u8; fft_size * 2];
    unsafe {
      ptr::copy_nonoverlapping(
        self.output_buffer.contents() as *const u8,
        data.as_mut_ptr(),
        data.len(),
      );
    }
    Ok(data)
  }
}
