"""Acquire Cargo's Unix artifact-directory lock before deleting cache files."""
import fcntl
import os
import shutil
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
    status = subprocess.call([node, script, profile], stdin=sys.stdin)
    if status == 0 and os.path.basename(profile) == 'dev-incremental':
        # Leave the lock inode in place: a waiting Cargo command must acquire
        # this same lock rather than a newly created, independently locked file.
        for name in ('dev-fast', 'debug'):
            retired = os.path.join(os.path.dirname(profile), name)
            if not os.path.isdir(retired) or os.path.islink(retired):
                continue
            retired_lock_path = os.path.join(retired, '.cargo-lock')
            if os.path.islink(retired_lock_path):
                continue
            with open(retired_lock_path, 'a') as retired_lock:
                try:
                    fcntl.flock(retired_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    print(f'[Rust cache] {name} is busy; deferred retirement.')
                    continue
                removed = 0
                for entry in os.scandir(retired):
                    if entry.name == '.cargo-lock':
                        continue
                    if entry.is_dir(follow_symlinks=False):
                        shutil.rmtree(entry.path)
                    else:
                        os.unlink(entry.path)
                    removed += 1
                if removed:
                    print(f'[Rust cache] Retired obsolete {name} artifacts.')
    sys.exit(status)
