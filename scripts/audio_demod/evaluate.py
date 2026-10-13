#!/usr/bin/env python3
"""Dispatch the encrypted ML implementation after bundle validation."""

from pathlib import Path
import os
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "scripts" / "encrypted-modules" / "runMlEntrypoint.mjs"
NODE = os.environ.get("NODE", "node")
COMMAND = [
    NODE,
    "--import",
    "tsx",
    str(RUNNER),
    "--runtime",
    "python",
    "--entry",
    "scripts/audio_demod/evaluate.py",
    "--",
    *sys.argv[1:],
]
raise SystemExit(subprocess.run(COMMAND, cwd=ROOT, check=False).returncode)
