# Shared environment defaults for build scripts
APP_URL=${APP_URL:-http://localhost:5173}
WEBSOCKETS_URL=${WEBSOCKETS_URL:-http://localhost:8765}
WASM_BUILD_PATH=${WASM_BUILD_PATH:-packages/n_apt_canvas}
UNSAFE_LOCAL_USER_PASSWORD=${UNSAFE_LOCAL_USER_PASSWORD:-n-apt-dev-key}

# Legacy aliases (to keep existing scripts working)
SITE_URL=${SITE_URL:-$APP_URL}
BACKEND_URL=${BACKEND_URL:-$WEBSOCKETS_URL}
WASM_OUT=${WASM_OUT:-$WASM_BUILD_PATH}
