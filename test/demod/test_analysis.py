import unittest

import numpy as np

from src.demod.analysis import (
    analyze_carrier_pair,
    iq_u8_to_complex,
    extract_pair_traces,
    repetition_score,
    detect_spike_events,
)


class AnalysisTests(unittest.TestCase):
    def test_iq_u8_conversion_centers_unsigned_samples(self):
        samples = iq_u8_to_complex(np.array([127, 128, 255, 0], dtype=np.uint8))

        np.testing.assert_allclose(samples, [(-0.5 + 0.5j) / 127.5, 1 - 1j])

    def test_carrier_pair_reports_two_symmetric_tones(self):
        sample_rate = 100_000
        time = np.arange(sample_rate) / sample_rate
        iq = np.exp(2j * np.pi * 3900 * time) + np.exp(-2j * np.pi * 3900 * time)

        result = analyze_carrier_pair(iq, sample_rate, search_band_hz=10_000)

        self.assertAlmostEqual(result.separation_hz, 7800, delta=20)
        self.assertAlmostEqual(result.midpoint_hz, 0, delta=20)
        self.assertEqual(len(result.peaks_hz), 2)

    def test_pair_traces_produce_sum_difference_and_phase_channels(self):
        sample_rate = 100_000
        time = np.arange(sample_rate) / sample_rate
        left = (1 + 0.3 * np.sin(2 * np.pi * 25 * time)) * np.exp(
            -2j * np.pi * 3900 * time
        )
        right = np.exp(2j * np.pi * 3900 * time)

        traces = extract_pair_traces(left + right, sample_rate, 7800, 3000)

        self.assertEqual(len(traces.sum), len(traces.difference))
        self.assertEqual(len(traces.sum), len(traces.phase_difference))
        self.assertGreater(np.std(traces.difference), 0)

    def test_repetition_score_is_high_for_repeated_trace(self):
        trace = np.tile([0.0, 1.0, 0.0, -1.0], 1000)

        self.assertGreater(repetition_score(trace, 4), 0.9)

    def test_spike_detector_finds_an_isolated_burst(self):
        sample_rate = 100_000
        time = np.arange(sample_rate) / sample_rate
        burst = (time > 0.4) & (time < 0.45)
        samples = burst * np.exp(2j * np.pi * 12_000 * time)

        events = detect_spike_events(
            samples, sample_rate, fft_size=1024, hop_size=256, threshold_db=8
        )

        self.assertTrue(events)
        self.assertTrue(any(abs(event.frequency_hz - 12_000) < 500 for event in events))


if __name__ == "__main__":
    unittest.main()
