"""Reusable NumPy/SciPy analysis for decrypted interleaved IQ captures."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import signal


@dataclass(frozen=True)
class CarrierPair:
    """The two strongest spectral components in a search band."""

    peaks_hz: tuple[float, float]
    midpoint_hz: float
    separation_hz: float
    powers_db: tuple[float, float]


@dataclass(frozen=True)
class PairTraces:
    """Downsampled traces derived from a pair of narrowband carriers."""

    sample_rate_hz: float
    left: np.ndarray
    right: np.ndarray
    sum: np.ndarray
    difference: np.ndarray
    phase_difference: np.ndarray


@dataclass(frozen=True)
class SpikeEvent:
    """One above-noise time-frequency event in a spectrogram frame."""

    time_s: float
    frequency_hz: float
    power_db: float
    bandwidth_hz: float
    symmetry: float


def iq_u8_to_complex(raw: np.ndarray) -> np.ndarray:
    """Convert interleaved unsigned 8-bit IQ to centered complex samples."""

    values = np.asarray(raw, dtype=np.uint8)
    if values.size % 2:
        raise ValueError("interleaved IQ requires an even number of bytes")
    centered = values.astype(np.float32) - 127.5
    return (centered[::2] + 1j * centered[1::2]) / 127.5


def analyze_carrier_pair(
    samples: np.ndarray,
    sample_rate_hz: float,
    search_band_hz: float,
    *,
    fft_size: int = 262_144,
    minimum_peak_separation_hz: float = 500.0,
) -> CarrierPair:
    """Find the two strongest separated components around baseband."""

    if samples.size < 2:
        raise ValueError("at least two complex samples are required")
    frequencies, powers = signal.welch(
        samples,
        fs=sample_rate_hz,
        nperseg=min(fft_size, samples.size),
        return_onesided=False,
        scaling="density",
    )
    frequencies = np.fft.fftshift(frequencies)
    powers = np.fft.fftshift(powers)
    mask = np.abs(frequencies) <= search_band_hz
    if np.count_nonzero(mask) < 3:
        raise ValueError("search band contains too few FFT bins")

    band_frequencies = frequencies[mask]
    bin_width_hz = abs(float(band_frequencies[1] - band_frequencies[0]))
    minimum_distance_bins = max(
        1, int(np.ceil(minimum_peak_separation_hz / bin_width_hz))
    )
    candidate_indices, _ = signal.find_peaks(
        powers[mask], distance=minimum_distance_bins
    )
    candidate_indices = candidate_indices[np.argsort(powers[mask][candidate_indices])[::-1]]
    if len(candidate_indices) < 2:
        raise ValueError("fewer than two spectral peaks found")
    selected = np.sort(candidate_indices[:2])
    peaks = frequencies[mask][selected]
    peak_powers = powers[mask][selected]
    midpoint = float(np.mean(peaks))
    return CarrierPair(
        peaks_hz=(float(peaks[0]), float(peaks[1])),
        midpoint_hz=midpoint,
        separation_hz=float(peaks[1] - peaks[0]),
        powers_db=tuple(float(10 * np.log10(max(p, 1e-30))) for p in peak_powers),
    )


def extract_pair_traces(
    samples: np.ndarray,
    sample_rate_hz: float,
    separation_hz: float,
    filter_bandwidth_hz: float,
    *,
    decimation: int = 1,
    midpoint_hz: float = 0.0,
) -> PairTraces:
    """Mix a carrier pair to baseband and return comparison traces.

    ``separation_hz`` is the distance between the carriers. The returned
    ``left`` and ``right`` traces are complex filtered carriers after mixing
    by the pair midpoint. ``sum`` and ``difference`` are their magnitudes;
    ``phase_difference`` is the wrapped phase of left times conjugate(right).
    """

    if samples.size < 8 or separation_hz <= 0 or filter_bandwidth_hz <= 0:
        raise ValueError("invalid samples or carrier-pair parameters")
    if decimation < 1 or decimation != int(decimation):
        raise ValueError("decimation must be a positive integer")

    time = np.arange(samples.size, dtype=np.float64) / sample_rate_hz
    baseband = samples * np.exp(-2j * np.pi * midpoint_hz * time)
    nyquist = sample_rate_hz / 2
    cutoff = min(nyquist * 0.99, filter_bandwidth_hz / 2)
    if cutoff <= 0:
        raise ValueError("filter bandwidth does not fit below Nyquist")
    sos = signal.butter(4, cutoff / nyquist, btype="lowpass", output="sos")
    left = signal.sosfiltfilt(
        sos, baseband * np.exp(2j * np.pi * separation_hz * time / 2)
    )
    right = signal.sosfiltfilt(
        sos, baseband * np.exp(-2j * np.pi * separation_hz * time / 2)
    )
    left = left[::decimation]
    right = right[::decimation]
    phase_difference = np.angle(left * np.conj(right))
    return PairTraces(
        sample_rate_hz=sample_rate_hz / decimation,
        left=left,
        right=right,
        sum=np.abs(left) + np.abs(right),
        difference=np.abs(left) - np.abs(right),
        phase_difference=phase_difference,
    )


def repetition_score(trace: np.ndarray, lag_samples: int) -> float:
    """Return normalized correlation of a trace with a lagged copy."""

    if lag_samples <= 0 or lag_samples >= trace.size:
        raise ValueError("lag must be inside the trace")
    first = np.asarray(trace[:-lag_samples], dtype=np.float64)
    second = np.asarray(trace[lag_samples:], dtype=np.float64)
    first -= first.mean()
    second -= second.mean()
    denominator = np.linalg.norm(first) * np.linalg.norm(second)
    return float(np.dot(first, second) / denominator) if denominator else 0.0


def detect_spike_events(
    samples: np.ndarray,
    sample_rate_hz: float,
    *,
    fft_size: int = 4096,
    hop_size: int | None = None,
    threshold_db: float = 10.0,
) -> list[SpikeEvent]:
    """Detect narrow spectral events without assuming paired carriers.

    Each returned event is a local spectral peak in one STFT frame. ``symmetry``
    compares power on either side of the peak and is useful for separating
    paired/symmetric events from isolated spikes.
    """

    if samples.size < fft_size or sample_rate_hz <= 0:
        raise ValueError("samples and sample rate are too small")
    hop = hop_size or fft_size // 4
    frequencies, times, values = signal.stft(
        samples,
        fs=sample_rate_hz,
        nperseg=fft_size,
        noverlap=fft_size - hop,
        return_onesided=False,
        boundary=None,
    )
    frequencies = np.fft.fftshift(frequencies)
    powers = np.fft.fftshift(np.abs(values) ** 2, axes=0)
    power_db = 10 * np.log10(np.maximum(powers, 1e-30))
    floor = float(np.median(power_db))
    events: list[SpikeEvent] = []
    bin_width = abs(float(frequencies[1] - frequencies[0]))
    for column, time_s in enumerate(times):
        frame = power_db[:, column]
        peaks, properties = signal.find_peaks(
            frame, height=floor + threshold_db, distance=max(1, fft_size // 64)
        )
        for peak, height in zip(peaks, properties["peak_heights"]):
            radius = max(1, min(peak, len(frame) - peak - 1))
            left = 10 ** (frame[peak - radius] / 10)
            right = 10 ** (frame[peak + radius] / 10)
            total = left + right
            events.append(
                SpikeEvent(
                    time_s=float(time_s),
                    frequency_hz=float(frequencies[peak]),
                    power_db=float(height),
                    bandwidth_hz=bin_width,
                    symmetry=float(min(left, right) / total) if total else 0.0,
                )
            )
    return events
