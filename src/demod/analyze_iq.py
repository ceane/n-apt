"""CLI for first-pass carrier-pair analysis of raw interleaved IQ bytes."""

from __future__ import annotations

import argparse

import numpy as np

from .analysis import analyze_carrier_pair, iq_u8_to_complex


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("iq_file", help="raw interleaved uint8 IQ file")
    parser.add_argument("--sample-rate", type=float, required=True)
    parser.add_argument("--search-band", type=float, default=10_000)
    parser.add_argument("--minimum-separation", type=float, default=500)
    args = parser.parse_args()

    pair = analyze_carrier_pair(
        iq_u8_to_complex(np.fromfile(args.iq_file, dtype=np.uint8)),
        args.sample_rate,
        args.search_band,
        minimum_peak_separation_hz=args.minimum_separation,
    )
    print(f"peaks_hz={pair.peaks_hz}")
    print(f"midpoint_hz={pair.midpoint_hz:.3f}")
    print(f"separation_hz={pair.separation_hz:.3f}")
    print(f"powers_db={pair.powers_db}")


if __name__ == "__main__":
    main()
