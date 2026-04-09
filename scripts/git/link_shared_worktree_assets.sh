#!/usr/bin/env bash

set -euo pipefail

SCRIPT_NAME=$(basename "$0")
SHARED_DIR=""
DRY_RUN=0
STATUS_ONLY=0
declare -a EXTRA_PATHS=()

usage() {
    cat <<EOF
Link heavy worktree directories (target/node_modules/redis) to a shared cache.

Usage: $SCRIPT_NAME [--shared-dir <path>] [--include <relative-path>] [--dry-run] [--status]

Options:
  --shared-dir <path>   Override the directory that stores shared caches.
                        Defaults to <repo>/.shared-worktree-cache in the common git dir.
  --include <path>      Additional relative path to link (can be passed multiple times).
  --dry-run             Show actions without making changes.
  --status              Only display current state of managed paths.
  -h, --help            Show this help text.

Examples:
  # Link default directories to the shared cache
  $SCRIPT_NAME

  # Use a custom shared cache directory
  $SCRIPT_NAME --shared-dir "$HOME/.local/share/n-apt-cache"

  # Add an extra directory to link
  $SCRIPT_NAME --include "redis/logs"
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --shared-dir)
            shift
            [[ $# -gt 0 ]] || { echo "Missing value for --shared-dir" >&2; exit 1; }
            SHARED_DIR="$1"
            ;;
        --include)
            shift
            [[ $# -gt 0 ]] || { echo "Missing value for --include" >&2; exit 1; }
            EXTRA_PATHS+=("$1")
            ;;
        --dry-run)
            DRY_RUN=1
            ;;
        --status)
            STATUS_ONLY=1
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            usage
            exit 1
            ;;
    esac
    shift || true
done

command -v git >/dev/null 2>&1 || { echo "git is required" >&2; exit 1; }

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null)
if [[ -z "$REPO_ROOT" || -z "$COMMON_DIR" ]]; then
    echo "Run this script from inside a git worktree" >&2
    exit 1
fi

COMMON_ROOT=$(cd "$COMMON_DIR/.." && pwd)
DEFAULT_SHARED="$COMMON_ROOT/.shared-worktree-cache"

resolve_path() {
    local input_path="$1"
    if command -v realpath >/dev/null 2>&1; then
        realpath "$input_path" 2>/dev/null && return 0
    fi
    if command -v python3 >/dev/null 2>&1; then
        python3 - <<'PY' "$input_path"
import os
import sys
print(os.path.realpath(sys.argv[1]))
PY
        return 0
    fi
    (cd "$input_path" && pwd)
}

REPO_ROOT=$(resolve_path "$REPO_ROOT")
DEFAULT_SHARED=$(resolve_path "$DEFAULT_SHARED")

if [[ -z "$SHARED_DIR" ]]; then
    SHARED_DIR="$DEFAULT_SHARED"
fi

mkdir -p "$SHARED_DIR"
SHARED_DIR=$(resolve_path "$SHARED_DIR")

BASE_PATHS=(
    "target"
    "node_modules"
    "redis/data"
    "redis/backups"
    ".redis_data"
)

ALL_PATHS=("${BASE_PATHS[@]}" "${EXTRA_PATHS[@]}")

if [[ ${#ALL_PATHS[@]} -eq 0 ]]; then
    echo "No paths specified to manage" >&2
    exit 1
fi

log_status() {
    local rel="$1"
    local source_path="$REPO_ROOT/$rel"

    if [[ -L "$source_path" ]]; then
        printf "%-20s -> %s\n" "$rel" "$(readlink "$source_path")"
    elif [[ -e "$source_path" ]]; then
        printf "%-20s -> %s\n" "$rel" "(exists locally, not linked)"
    else
        printf "%-20s -> %s\n" "$rel" "(missing)"
    fi
}

if [[ $STATUS_ONLY -eq 1 ]]; then
    echo "Repo root: $REPO_ROOT"
    echo "Shared dir: $SHARED_DIR"
    echo ""
    for rel in "${ALL_PATHS[@]}"; do
        log_status "$rel"
    done
    exit 0
fi

require_rsync() {
    if command -v rsync >/dev/null 2>&1; then
        echo "rsync"
    else
        echo ""
    fi
}

RSYNC_BIN=$(require_rsync)

is_linked_to_shared() {
    local rel="$1"
    local source_path="$REPO_ROOT/$rel"
    local target_path="$SHARED_DIR/$rel"

    [[ -L "$source_path" ]] && [[ "$(readlink "$source_path")" == "$target_path" ]]
}

NEEDS_LINKING=0
for rel in "${ALL_PATHS[@]}"; do
    if ! is_linked_to_shared "$rel"; then
        NEEDS_LINKING=1
        break
    fi
done

if [[ $NEEDS_LINKING -eq 0 ]]; then
    echo "All managed paths already linked to $SHARED_DIR. Nothing to do."
    exit 0
fi

link_path() {
    local rel="$1"
    local source_path="$REPO_ROOT/$rel"
    local target_path="$SHARED_DIR/$rel"
    local target_parent
    target_parent=$(dirname "$target_path")

    if [[ "$source_path" == "$target_path" ]]; then
        printf "Skipping %-20s (already points to shared cache)\n" "$rel"
        return
    fi

    printf "Linking %-20s" "$rel"
    if [[ $DRY_RUN -eq 1 ]]; then
        echo " (dry run)"
        echo "  would ensure $target_path exists"
        echo "  would link $source_path -> $target_path"
        return
    fi

    mkdir -p "$target_parent"
    mkdir -p "$target_path"

    if [[ -L "$source_path" ]]; then
        local current_target
        current_target=$(readlink "$source_path")
        if [[ "$current_target" == "$target_path" ]]; then
            echo " already linked"
            return
        else
            rm "$source_path"
        fi
    fi

    if [[ -e "$source_path" ]]; then
        if [[ -n "$RSYNC_BIN" && -d "$source_path" ]]; then
            if $RSYNC_BIN -a "$source_path"/ "$target_path"/; then
                rm -rf "$source_path"
            else
                echo " (copy failed, leaving local path in place)"
                return
            fi
        else
            if [[ ! -e "$target_path" || -z $(ls -A "$target_path" 2>/dev/null) ]]; then
                if mv "$source_path" "$target_path"; then
                    :
                else
                    echo " (move failed, leaving local path in place)"
                    return
                fi
            else
                local backup="$target_path.migrated.$(date +%s)"
                echo " (conflict detected, moving local copy to $backup)"
                if ! mv "$source_path" "$backup"; then
                    echo " (backup move failed, leaving local path in place)"
                    return
                fi
            fi
        fi
    else
        mkdir -p "$target_path"
    fi

    if ln -sfn "$target_path" "$source_path"; then
        echo " linked"
    else
        echo " (symlink failed, keeping expanded path)"
    fi
}

echo "Repo root : $REPO_ROOT"
echo "Shared dir: $SHARED_DIR"
echo ""

for rel in "${ALL_PATHS[@]}"; do
    link_path "$rel"
done

echo ""
echo "Done. Use '$SCRIPT_NAME --status' to inspect symlinks."

