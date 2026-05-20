// GPU-side parallel reduction to compute the average (floor) of the waveform.
// Replaces the CPU-side `for` loop that was blocking the main thread every frame.
//
// Strategy: Each workgroup reduces its chunk of the waveform using shared memory.
// The partial sums and counts are atomically added to global accumulators.
// A second entry point (`finalize`) divides the sum by the count to produce
// the final average, which the spike compute shader reads as `global_floor`.

struct FloorResult {
  sum_bits: atomic<u32>,    // IEEE-754 bits — reinterpreted as f32 after finalize
  count: atomic<u32>,
  partial_sum: atomic<i32>, // Fixed-point accumulator (×1024) for atomicAdd precision
}

@group(0) @binding(0) var<storage, read> waveform: array<f32>;
@group(0) @binding(1) var<storage, read_write> result: FloorResult;
@group(0) @binding(2) var<uniform> params: vec2<u32>; // [length, 0]

var<workgroup> shared_sum: array<f32, 64>;

@compute @workgroup_size(64)
fn reduce(@builtin(global_invocation_id) gid: vec3<u32>,
          @builtin(local_invocation_id) lid: vec3<u32>) {
  let i = gid.x;
  let length = params.x;

  // Load — out of bounds threads contribute 0
  var val: f32 = 0.0;
  if (i < length) {
    val = waveform[i];
    // NaN guard
    if (val != val) { val = 0.0; }
  }

  shared_sum[lid.x] = val;
  workgroupBarrier();

  // Tree reduction within the workgroup
  for (var stride: u32 = 32u; stride > 0u; stride = stride >> 1u) {
    if (lid.x < stride) {
      shared_sum[lid.x] = shared_sum[lid.x] + shared_sum[lid.x + stride];
    }
    workgroupBarrier();
  }

  // Thread 0 of each workgroup adds the partial sum to the global accumulator
  if (lid.x == 0u) {
    // Use fixed-point to get deterministic atomicAdd on integers.
    // Multiply by 1024 to preserve ~3 decimal digits of precision.
    let fixed = i32(shared_sum[0u] * 1024.0);
    atomicAdd(&result.partial_sum, fixed);

    // Count how many valid samples this workgroup covered
    let wg_start = gid.x - lid.x;
    let wg_end = min(wg_start + 64u, length);
    let wg_count = select(0u, wg_end - wg_start, wg_end > wg_start);
    atomicAdd(&result.count, wg_count);
  }
}

@compute @workgroup_size(1)
fn finalize() {
  let count = atomicLoad(&result.count);
  if (count == 0u) {
    atomicStore(&result.sum_bits, bitcast<u32>(0.0));
    return;
  }
  let sum_fixed = atomicLoad(&result.partial_sum);
  let avg = (f32(sum_fixed) / 1024.0) / f32(count);
  atomicStore(&result.sum_bits, bitcast<u32>(avg));
}
