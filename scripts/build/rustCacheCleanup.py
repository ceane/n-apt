"""Acquire Cargo's Unix artifact-directory lock before deleting cache files."""
import fcntl
import os
import subprocess
import sys

profile, node, script = sys.argv[1:]
lock_path = os.path.join(profile, '.cargo-lock')
with open(lock_path, 'a') as lock:
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print('[Rust cache] Another Cargo command is active; deferred cleanup.')
        sys.exit(0)
    sys.exit(subprocess.call([node, script, profile], stdin=sys.stdin))
