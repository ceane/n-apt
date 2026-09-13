#!/bin/sh

set -eu

ROOT=$(git rev-parse --show-toplevel)
git -C "$ROOT" config core.hooksPath .githooks
echo "Git hooks configured: $ROOT/.githooks"
