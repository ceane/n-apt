"""Version-4 feature extraction shared with audioSurveyMl.ts."""

from __future__ import annotations

import numpy as np


WINDOW_COMPLEX_SAMPLES = 64
IQ_FEATURE_COUNT = WINDOW_COMPLEX_SAMPLES * 2
FOURIER_FEATURE_COUNT = WINDOW_COMPLEX_SAMPLES
MODEL_INPUT_COUNT = IQ_FEATURE_COUNT + FOURIER_FEATURE_COUNT
HANN = np.hanning(WINDOW_COMPLEX_SAMPLES).astype(np.float32)


def _fftshifted_power(real: np.ndarray, imaginary: np.ndarray) -> np.ndarray:
    """Mirror the browser's in-place radix-2 FFT and fftshift bin order."""
    size = WINDOW_COMPLEX_SAMPLES
    reversed_indices = np.empty(size, dtype=np.int64)
    reversed_index = 0
    reversed_indices[0] = 0
    for index in range(1, size):
        bit = size >> 1
        while reversed_index & bit:
            reversed_index ^= bit
            bit >>= 1
        reversed_index ^= bit
        reversed_indices[index] = reversed_index
    real = real[:, reversed_indices].copy()
    imaginary = imaginary[:, reversed_indices].copy()

    for width in (2, 4, 8, 16, 32, 64):
        half_width = width >> 1
        twiddle_stride = size // width
        for start in range(0, size, width):
            for offset in range(half_width):
                angle = -2.0 * np.pi * offset * twiddle_stride / size
                twiddle_real = np.cos(angle)
                twiddle_imaginary = np.sin(angle)
                even_index = start + offset
                odd_index = even_index + half_width
                odd_real = real[:, odd_index].astype(np.float64)
                odd_imaginary = imaginary[:, odd_index].astype(np.float64)
                product_real = (odd_real * twiddle_real - odd_imaginary * twiddle_imaginary).astype(np.float32)
                product_imaginary = (odd_real * twiddle_imaginary + odd_imaginary * twiddle_real).astype(np.float32)
                even_real = real[:, even_index].copy()
                even_imaginary = imaginary[:, even_index].copy()
                real[:, odd_index] = (even_real - product_real).astype(np.float32)
                imaginary[:, odd_index] = (even_imaginary - product_imaginary).astype(np.float32)
                real[:, even_index] = (even_real + product_real).astype(np.float32)
                imaginary[:, even_index] = (even_imaginary + product_imaginary).astype(np.float32)

    real64 = real.astype(np.float64)
    imaginary64 = imaginary.astype(np.float64)
    power = real64 * real64 + imaginary64 * imaginary64
    midpoint = size // 2
    return np.concatenate((power[:, midpoint:], power[:, :midpoint]), axis=1)


def build_model_inputs(iq_u8: np.ndarray, pcm_sample_count: int, pcm_indices: np.ndarray) -> np.ndarray:
    """Build raw-IQ plus FFT features for selected PCM sample positions."""
    iq = np.asarray(iq_u8, dtype=np.uint8)
    indices = np.asarray(pcm_indices, dtype=np.int64)
    complex_count = iq.size // 2
    if (
        iq.ndim != 1
        or iq.size < 2
        or iq.size % 2
        or pcm_sample_count < 1
        or indices.ndim != 1
        or np.any(indices < 0)
        or np.any(indices >= pcm_sample_count)
    ):
        raise ValueError("Cannot build model inputs from invalid paired I/Q and PCM ranges")

    current_iq = np.floor(((indices + 0.5) * complex_count) / pcm_sample_count).astype(np.int64)
    first_iq = current_iq - (WINDOW_COMPLEX_SAMPLES - 1)
    window_indices = first_iq[:, None] + np.arange(WINDOW_COMPLEX_SAMPLES, dtype=np.int64)[None, :]
    valid = (window_indices >= 0) & (window_indices < complex_count)
    bounded = np.clip(window_indices, 0, complex_count - 1)
    complex_samples = iq.reshape(complex_count, 2).astype(np.float32)
    iq_windows = (complex_samples[bounded] - 128.0) / 128.0
    iq_windows *= valid[..., None]

    real = iq_windows[..., 0] * HANN
    imaginary = iq_windows[..., 1] * HANN
    power = _fftshifted_power(real, imaginary)
    max_power = np.maximum(power.max(axis=1, keepdims=True), 1e-12)
    max_db = 10.0 * np.log10(max_power)
    db = 10.0 * np.log10(np.maximum(power, max_power * 1e-5))
    fourier = np.clip((db - max_db) / 50.0, -1.0, 0.0).astype(np.float32)
    result = np.concatenate((iq_windows.reshape(-1, IQ_FEATURE_COUNT), fourier), axis=1)
    if result.shape != (indices.size, MODEL_INPUT_COUNT) or not np.isfinite(result).all():
        raise ValueError("Audio feature extraction produced invalid model inputs")
    return result.astype(np.float32, copy=False)
