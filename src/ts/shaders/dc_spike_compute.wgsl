struct DcSpikeParams {
  length: u32,
  reserved_0: u32,
  reserved_1: u32,
  reserved_2: u32,
};

@group(0) @binding(0) var<storage, read> spectrum_in: array<f32>;
@group(0) @binding(1) var<storage, read_write> spectrum_out: array<f32>;
@group(0) @binding(2) var<uniform> params: DcSpikeParams;

@compute @workgroup_size(64)
fn remove_dc_spike(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let index = global_id.x;
  if (index >= params.length) {
    return;
  }

  let center = params.length / 2u;
  if (params.length >= 3u && index == center) {
    let left = spectrum_in[center - 1u];
    let right = spectrum_in[center + 1u];
    spectrum_out[index] = (left + right) * 0.5;
    return;
  }

  spectrum_out[index] = spectrum_in[index];
}
