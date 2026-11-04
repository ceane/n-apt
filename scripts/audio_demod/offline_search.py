#!/usr/bin/env python3
"""Dispatch protected offline audio-search commands after bundle validation."""

from pathlib import Path
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "scripts" / "encrypted-modules" / "runMlEntrypoint.mjs"
raise SystemExit(subprocess.run([
    os.environ.get("NODE", "node"), "--import", "tsx", str(RUNNER),
    "--runtime", "python", "--entry", "scripts/audio_demod/offline_search.py",
    "--", *sys.argv[1:],
], cwd=ROOT, check=False).returncode)
