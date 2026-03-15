use n_apt_backend::sdr::processor::SdrProcessor;
use n_apt_backend::sdr::processor::CaptureChannel;
use num_complex::Complex;
use anyhow::Result;

fn synth_channel(len: usize, left_rolloff_db: f32, right_rolloff_db: f32) -> Vec<f32> {
  (0..len)
    .map(|i| {
      let x = i as f32 / (len.saturating_sub(1).max(1)) as f32;
      let left = (1.0 - x).powf(2.2) * left_rolloff_db;
      let right = x.powf(2.2) * right_rolloff_db;
      let ripple = ((i as f32) * 0.037).sin() * 1.5;
      let hump = -72.0 + (((x - 0.5) * 8.0).cos() * 2.0);
      hump - left - right + ripple
    })
    .collect()
}

fn overlap_bounds(total_span: f64, hop_bw: f64, usable_bw: f64) -> (usize, usize, usize) {
  let fft_size = 1024usize;
  let min_freq = 0.0;
  let max_freq = total_span;
  let first_center = min_freq + usable_bw / 2.0;
  let last_center = max_freq - usable_bw / 2.0;
  let hop1_max = first_center + hop_bw / 2.0;
  let hop2_min = last_center - hop_bw / 2.0;
  let overlap_hz = hop1_max - hop2_min;
  let midpoint_hz = (hop1_max + hop2_min) / 2.0;
  let prev_overlap_hz = hop1_max - midpoint_hz;
  let curr_overlap_hz = midpoint_hz - hop2_min;
  let prev_trim_bins = ((fft_size as f64) * (prev_overlap_hz / hop_bw)).round() as usize;
  let curr_trim_bins = ((fft_size as f64) * (curr_overlap_hz / hop_bw)).round() as usize;
  assert!(overlap_hz > 0.0);
  (fft_size, prev_trim_bins, curr_trim_bins)
}

fn hard_stitch(prev: &[f32], curr: &[f32], prev_trim_bins: usize, curr_trim_bins: usize) -> Vec<f32> {
  let mut out = Vec::with_capacity((prev.len() - prev_trim_bins) + (curr.len() - curr_trim_bins));
  out.extend_from_slice(&prev[..prev.len() - prev_trim_bins]);
  out.extend_from_slice(&curr[curr_trim_bins..]);
  out
}

fn normalized_stitch(prev: &[f32], curr: &[f32], prev_trim_bins: usize, curr_trim_bins: usize) -> Vec<f32> {
  let prev_kept = &prev[..prev.len() - prev_trim_bins];
  let curr_kept = &curr[curr_trim_bins..];
  let seam = prev_kept.len().min(curr_kept.len()).min(128);
  let prev_avg: f32 = prev_kept[prev_kept.len() - seam..].iter().sum::<f32>() / seam as f32;
  let curr_avg: f32 = curr_kept[..seam].iter().sum::<f32>() / seam as f32;
  let delta = prev_avg - curr_avg;
  let adjusted_curr: Vec<f32> = curr.iter().map(|v| *v + delta).collect();
  hard_stitch(prev, &adjusted_curr, prev_trim_bins, curr_trim_bins)
}

fn blended_stitch(prev: &[f32], curr: &[f32], prev_trim_bins: usize, curr_trim_bins: usize) -> Vec<f32> {
  let prev_kept = &prev[..prev.len() - prev_trim_bins];
  let curr_kept = &curr[curr_trim_bins..];
  let seam = prev_kept.len().min(curr_kept.len()).min(96);
  let mut left = prev_kept.to_vec();
  let mut right = curr_kept.to_vec();
  for k in 0..seam {
    let t = (k + 1) as f32 / (seam + 1) as f32;
    let li = left.len() - seam + k;
    let ri = k;
    let target = 0.5 * (left[li] + right[ri]);
    left[li] = left[li] * (1.0 - t) + target * t;
    right[ri] = right[ri] * t + target * (1.0 - t);
  }
  let mut out = left;
  out.extend_from_slice(&right);
  out
}

fn seam_dip(stitched: &[f32]) -> f32 {
  let seam = stitched.len() / 2;
  let left_avg: f32 = stitched[seam - 64..seam].iter().sum::<f32>() / 64.0;
  let right_avg: f32 = stitched[seam..seam + 64].iter().sum::<f32>() / 64.0;
  let center_avg: f32 = stitched[seam - 8..seam + 8].iter().sum::<f32>() / 16.0;
  ((left_avg + right_avg) * 0.5) - center_avg
}

fn leading_edge_deficit(reference: &[f32], candidate: &[f32]) -> f32 {
  let span = reference.len().min(candidate.len()).min(128);
  let ref_avg: f32 = reference[..span].iter().sum::<f32>() / span as f32;
  let cand_avg: f32 = candidate[..span].iter().sum::<f32>() / span as f32;
  ref_avg - cand_avg
}

fn contaminate_frames(
  clean_prev: &[f32],
  clean_curr: &[f32],
  contaminated_frames: usize,
  total_frames: usize,
) -> Vec<Vec<f32>> {
  (0..total_frames)
    .map(|frame_idx| {
      if frame_idx < contaminated_frames {
        let mix = 1.0 - ((frame_idx + 1) as f32 / (contaminated_frames + 1) as f32);
        clean_curr
          .iter()
          .zip(clean_prev.iter())
          .map(|(curr, prev)| curr * (1.0 - mix) + prev * mix)
          .collect()
      } else {
        clean_curr.to_vec()
      }
    })
    .collect()
}

fn warmup_ramp_frames(
  clean_prev: &[f32],
  clean_curr: &[f32],
  warmup_frames: usize,
  total_frames: usize,
) -> Vec<Vec<f32>> {
  (0..total_frames)
    .map(|frame_idx| {
      if frame_idx < warmup_frames {
        let progress = (frame_idx + 1) as f32 / (warmup_frames + 1) as f32;
        let prev_mix = (1.0 - progress).powf(1.8) * 0.55;
        let gain = 0.35 + 0.65 * progress.powf(1.4);
        clean_curr
          .iter()
          .zip(clean_prev.iter())
          .map(|(curr, prev)| (curr * gain) + (prev * prev_mix))
          .collect()
      } else {
        clean_curr.to_vec()
      }
    })
    .collect()
}

fn average_frames(frames: &[Vec<f32>], skip: usize) -> Vec<f32> {
  let kept = &frames[skip.min(frames.len())..];
  let len = kept.first().map(|f| f.len()).unwrap_or(0);
  let mut out = vec![0.0; len];
  if kept.is_empty() {
    return out;
  }
  for frame in kept {
    for (dst, src) in out.iter_mut().zip(frame.iter()) {
      *dst += *src;
    }
  }
  let scale = 1.0 / kept.len() as f32;
  for v in &mut out {
    *v *= scale;
  }
  out
}

#[test]
fn reports_seam_dip_for_overlap_strategies() {
  let hop_bw = 3.2f64;
  let usable_bw = 3.2f64 * 0.8;
  let total_span = 4.69f64;
  let (fft_size, prev_trim_bins, curr_trim_bins) = overlap_bounds(total_span, hop_bw, usable_bw);

  let prev = synth_channel(fft_size, 0.5, 18.0);
  let curr = synth_channel(fft_size, 18.0, 0.5);

  let hard = hard_stitch(&prev, &curr, prev_trim_bins, curr_trim_bins);
  let normalized = normalized_stitch(&prev, &curr, prev_trim_bins, curr_trim_bins);
  let blended = blended_stitch(&prev, &curr, prev_trim_bins, curr_trim_bins);

  let hard_dip = seam_dip(&hard);
  let normalized_dip = seam_dip(&normalized);
  let blended_dip = seam_dip(&blended);

  eprintln!(
    "hard_dip_db={hard_dip:.3} normalized_dip_db={normalized_dip:.3} blended_dip_db={blended_dip:.3}"
  );

  assert!(hard_dip > 0.25);
  assert!(normalized_dip <= hard_dip + 0.25);
  assert!(blended_dip + 0.25 < hard_dip);
  assert!(blended_dip <= normalized_dip);
}

#[test]
fn reports_temporal_seam_dip_vs_post_hop_skip() {
  let hop_bw = 3.2f64;
  let usable_bw = 3.2f64 * 0.8;
  let total_span = 4.69f64;
  let (fft_size, prev_trim_bins, curr_trim_bins) =
    overlap_bounds(total_span, hop_bw, usable_bw);

  let prev = synth_channel(fft_size, 0.5, 18.0);
  let curr = synth_channel(fft_size, 18.0, 0.5);
  let contaminated = contaminate_frames(&prev, &curr, 4, 8);

  let base = blended_stitch(&prev, &curr, prev_trim_bins, curr_trim_bins);
  let base_dip = seam_dip(&base);

  let mut dips = Vec::new();
  for skip in 0..=5 {
    let avg_curr = average_frames(&contaminated, skip);
    let stitched = blended_stitch(&prev, &avg_curr, prev_trim_bins, curr_trim_bins);
    dips.push((skip, seam_dip(&stitched)));
  }

  eprintln!("base_dip_db={base_dip:.3} temporal_dips={dips:?}");

  let dip_skip_0 = dips.iter().find(|(s, _)| *s == 0).unwrap().1;
  let dip_skip_2 = dips.iter().find(|(s, _)| *s == 2).unwrap().1;
  let dip_skip_4 = dips.iter().find(|(s, _)| *s == 4).unwrap().1;

  assert!((dip_skip_0 - base_dip).abs() < 0.1);
  assert!(dip_skip_4 >= dip_skip_0);
  assert!((dip_skip_4 - dip_skip_2).abs() < 0.15);
}

#[test]
fn reports_retune_warmup_dip_vs_discarded_frames() {
  let fft_size = 1024usize;
  let prev = synth_channel(fft_size, 0.5, 18.0);
  let curr = synth_channel(fft_size, 18.0, 0.5);
  let warmed_up = warmup_ramp_frames(&prev, &curr, 3, 8);

  let mut deficits = Vec::new();
  for skip in 0..=4 {
    let avg_curr = average_frames(&warmed_up, skip);
    deficits.push((skip, leading_edge_deficit(&curr, &avg_curr)));
  }

  eprintln!("warmup_leading_edge_deficits={deficits:?}");

  let deficit_skip_0 = deficits.iter().find(|(s, _)| *s == 0).unwrap().1;
  let deficit_skip_1 = deficits.iter().find(|(s, _)| *s == 1).unwrap().1;
  let deficit_skip_2 = deficits.iter().find(|(s, _)| *s == 2).unwrap().1;
  let deficit_skip_3 = deficits.iter().find(|(s, _)| *s == 3).unwrap().1;
  let err_skip_0 = deficit_skip_0.abs();
  let err_skip_1 = deficit_skip_1.abs();
  let err_skip_2 = deficit_skip_2.abs();
  let err_skip_3 = deficit_skip_3.abs();

  assert!(err_skip_0 > 3.0);
  assert!(err_skip_1 + 1.0 < err_skip_0);
  assert!(err_skip_2 + 1.0 < err_skip_1);
  assert!(err_skip_3 < 0.5);
}

#[cfg(not(target_arch = "wasm32"))]
#[tokio::test]
async fn test_live_stitching_from_sdr() -> Result<()> {
  // Only run this test if RTL_SDR_LIVE=1 is set
  if std::env::var("RTL_SDR_LIVE").is_err() {
    println!("Skipping live SDR test (RTL_SDR_LIVE not set)");
    return Ok(());
  }

  let mut processor = SdrProcessor::new()?;
  processor.initialize()?;
  
  if processor.is_mock() {
    println!("SdrProcessor returned mock device, skipping live data test");
    return Ok(());
  }

  println!("Capturing live data from {}...", processor.get_device_info());
  
  // Configure for a 2-hop capture
  let hop_bw = processor.get_sample_rate() as f64 / 1_000_000.0;
  let total_span = hop_bw * 1.5;
  let min_f = 100.0; // Assume 100MHz for test
  let max_f = min_f + total_span;
  
  // We'll manually perform two reads at different frequencies
  let center1 = min_f + (hop_bw * 0.4);
  let center2 = max_f - (hop_bw * 0.4);
  
  processor.set_center_frequency((center1 * 1_000_000.0) as u32)?;
  std::thread::sleep(std::time::Duration::from_millis(200)); // Settle
  let frame1 = processor.read_and_process_frame()?;
  
  processor.set_center_frequency((center2 * 1_000_000.0) as u32)?;
  std::thread::sleep(std::time::Duration::from_millis(200)); // Settle
  let frame2 = processor.read_and_process_frame()?;
  
  // Use our stitching algorithms on real data
  let usable_bw = hop_bw * 0.75;
  let (fft_size, prev_trim, curr_trim) = overlap_bounds(total_span, hop_bw, usable_bw);
  
  // Ensure our frames match the expected fft_size from bounds
  // Actually frames from processor might be different size, but let's assume they match for now
  // or resample.
  
  let stitched = blended_stitch(&frame1, &frame2, prev_trim, curr_trim);
  let dip = seam_dip(&stitched);
  
  println!("Live stitching dip: {:.3} dB", dip);
  
  Ok(())
}
