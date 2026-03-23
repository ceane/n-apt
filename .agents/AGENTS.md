# N-APT Development Guide

This file provides guidance for AI coding agents working on N-APT (RF spectrum analyzer).

## Project Overview

N-APT is an RF spectrum analyzer that processes signal data from SDR hardware. It consists of:

- **Frontend**: React 19 + TypeScript + Vite + styled-components
- **Backend**: Rust (Axum WebSocket server with tokio)
- **WASM**: Rust compiled to WebAssembly for FFT processing
- **Canvas**: Custom FFT and waterfall renderers

## Build Commands

### Frontend

```bash
npm run dev          # Full dev with Ink build orchestrator
npm run build        # Production build
npm run preview      # Preview production build
```

### Testing

```bash
npm test                          # Run all tests
npm run test:watch               # Watch mode
npm run test:coverage            # Coverage report
npm test -- --testPathPattern=FileWorker  # Single test file
npm test -- -t "test name"                # Tests matching name pattern
npm run test:rust                  # Rust tests (cargo test)
npm run test:all                   # Both npm test && cargo test

# Run specific Jest test files
npm test -- test/ts/FFTCanvas.test.tsx
npm test -- test/ts/useWebSocket.test.tsx
```

### Backend (Rust)

```bash
npm run server:dev   # Dev with auto-reload
npm run server:build # Build only
cargo test           # Run tests
cargo test fft       # Run tests matching "fft"
cargo test --release # Release mode tests
cargo fmt            # Format
cargo clippy         # Lint
```

### Linting & Formatting

```bash
npm run lint         # oxlint
npm run lint:fix     # Fix issues
npm run format       # oxfmt
npm run format:check # Check formatting
npm run typecheck    # TypeScript
```

## Code Style

### TypeScript

**Formatting** (oxfmt):

- Print width: 80, Tab width: 2, Use spaces
- Single quotes, Semicolons: yes, Trailing commas: none

**Naming Conventions**:

- Variables/functions: camelCase
- Types/interfaces: PascalCase
- Constants: UPPER_SNAKE_CASE
- File names: camelCase.ts/tsx

**Imports** (CRITICAL - enforced by WindSurf):
Use `@n-apt/*` namespace for ALL internal imports. NEVER use relative paths.

```typescript
// ✅ Correct
import { useState } from "react";
import { decryptPayload } from "@n-apt/crypto/webcrypto";
import { FFTCanvas } from "@n-apt/components";
import { useWebSocket } from "@n-apt/hooks";

// ❌ Incorrect - will fail lint
import { decryptPayload } from "../crypto/webcrypto";
import { FFTCanvas } from "./components/FFTCanvas";
```

**Types**:

- Use explicit types for function parameters and return types
- Use `type` for unions/tuples, `interface` for objects
- Avoid `any`, use `unknown` when type is truly unknown

**Error Handling**: Empty catch only for expected parsing errors.

```typescript
// Good - ignore malformed JSON
try { const data = JSON.parse(raw); } catch { /* ignore */ }

// Bad - should have meaningful handling
try { ... } catch { console.error("error") }
```

**React Patterns**:

- Use hooks with proper dependency arrays
- Use `useCallback` for functions passed as props
- Avoid prop drilling, use context when appropriate
- Use `styled-components` for styling and never use React.CSSProperties or the style prop

### Rust

**Formatting** (rustfmt):

- 2-space indentation, 80 char max width
- Edition 2021, crate-level imports
- Imports grouped: StdExternalCrate

**Naming**:

- Variables/functions: snake_case
- Types: PascalCase
- Constants: SCREAMING_SNAKE

**Error Handling**:

- Use `anyhow` for application errors
- Use `?` operator for propagation
- Avoid unwrap() in production

```rust
// Good
fn process_data(input: &str) -> Result<Data, anyhow::Error> {
  let parsed = serde_json::from_str::<Payload>(input)?;
  Ok(parsed.into())
}
```

## WindSurf Rules

- `.windsurf/rules/namespacing.md`: Enforces `@n-apt/*` import paths
- `.windsurf/workflows/review.md`: Code review workflow (auto-execution disabled)

## Project Structure

```
n-apt/
├── src/
│   ├── components/       # React components
│   ├── hooks/            # React hooks (useWebSocket, useFFT, etc.)
│   ├── consts/           # Constants, config, mock data
│   ├── fft/              # FFT canvas renderer
│   ├── waterfall/        # Waterfall renderer
│   ├── crypto/           # WebCrypto encryption
│   └── services/         # Auth, API services
├── test/
|   ├── ts/               # Typescript and Jest tests
|   ├── rust/             # Rust tests
|   ├── wasm/             # Wasm tests
├── src/                  # Rust backend
│   ├── server/           # Axum WebSocket server
│   ├── fft/              # FFT processing
│   ├── wasm_simd/        # WASM SIMD implementations
│   ├── rtlsdr/           # RTL-SDR device interface
│   └── credentials/      # Auth/password handling
├── mock_signals.yaml     # Hot-reloadable signal config
└── package.json
```

## Key Conventions

1. **Hot Reload**: Edit `mock_signals.yaml` while server runs - changes apply automatically
2. **WASM Changes**: Use `npm run dev` (rebuilds WASM)
3. **Fast Iteration**: Use `npm run dev` (single orchestrated flow)
4. **Before Commit**: Run `npm run test:all`
5. **Encryption**: WebSocket uses AES-256-GCM, auth via WebAuthn passkeys or password

## Environment

- Node.js: ES modules (type: "module")
- TypeScript: Strict mode, noImplicitAny
- React: 19.x with hooks
- Rust: 2021 edition, tokio async
- WebSocket: Authenticated with token in URL query param
