// Packed artifact: kind, mean[18], scale[18], weights[hidden*18], bias[hidden], output[16], output_bias.
@group(0) @binding(0) var<storage, read> features: array<f32>;
@group(0) @binding(1) var<storage, read> model: array<f32>;
@group(0) @binding(2) var<storage, read_write> result: array<f32>;
@compute @workgroup_size(1)
fn main() {
  let hidden = select(1u, 16u, model[0] > 0.5);
  let bias_start = 37u + hidden * 18u;
  var logit = 0.0;
  for (var j = 0u; j < hidden; j++) {
    var value = model[bias_start + j];
    for (var i = 0u; i < 18u; i++) {
      value += model[37u + j * 18u + i] * ((features[i] - model[1u + i]) / model[19u + i]);
    }
    if (hidden == 1u) { logit = value; }
    else { logit += max(0.0, value) * model[bias_start + hidden + j]; }
  }
  if (hidden == 16u) { logit += model[bias_start + 32u]; }
  result[0] = 1.0 / (1.0 + exp(-clamp(logit, -80.0, 80.0)));
}
