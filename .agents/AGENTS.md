# N-APT Development Guide

This file provides guidance for AI coding agents working on N-APT (RF spectrum analyzer).

## Token Efficiency

- DO NOT RERUN THE DEV SERVER!
- Never re-read files you just wrote or edited. You know the contents.
- Never re-run commands to "verify" unless the outcome was uncertain.
- Don't echo back large blocks of code or file contents unless asked.
- Batch related edits into single operations. Don't make 5 edits when 1 handles it.
- Skip confirmations like "I'll continue..." Just do it.
- If a task needs 1 tool call, don't use 3. Plan before acting.
- Do not summarize what you just did unless the result is ambiguous or you need additional input.

## Documentation Guidelines

### Feature Documentation Location

When creating markdown files for completed features, work done, or implementation summaries, **always place them in the `.agents/` directory**.

**Examples:**

- `/.agents/MARKDOWN_FOR_AGENTS_AND_MCP.md` - Implementation summaries
- `/.agents/FEATURE_COMPLETION_SUMMARY.md` - Feature completion documentation
- `/.agents/WORK_SESSION_NOTES.md` - Work session notes and progress

This keeps all agent-focused documentation organized and separate from user-facing content while maintaining a clear record of work completed.

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
npm run dev:markdown # Markdown preview server
npm run build        # Production build
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

# Rust formatting (optimized)
npm run format:rust      # Parallel formatting for all files
npm run format:rust:fast # Incremental formatting for changed files only
npm run format:rust:check # Check formatting without changes
rustfmt                  # Standard rustfmt
```

## Rustfmt Performance Optimization

The project includes optimized Rustfmt configurations to address slow formatting performance:

### Optimized Configuration (`rustfmt.toml`)

- Disabled expensive features: comment formatting, doc attribute normalization
- Enabled performance optimizations: `merge_derives = true`, disabled string formatting
- Reduced formatting overhead with minimal configuration

### Fast Formatting Scripts

**Parallel Formatting** (`scripts/rust/rustfmt-parallel.sh`):

- Uses `xargs -P` to format multiple files simultaneously
- Leverages all CPU cores for faster processing
- Best for full codebase formatting

**Incremental Formatting** (`scripts/rust/rustfmt-fast.sh`):

- Only formats files changed since last run
- Uses timestamp-based caching to skip unchanged files
- Ideal for frequent development formatting

### Usage Recommendations
- **During development**: `npm run format:rust:fast` for quick incremental formatting
- **Before commits**: `npm run format:rust` for full parallel formatting  
- **CI/CD**: `npm run format:rust:check` to verify formatting

These optimizations significantly speed up Rustfmt, especially for the 90+ Rust files in the codebase.

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
├── signals.yaml     # Hot-reloadable signal config
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

## Server Configuration

The project has multiple server configurations:

### Main Application Server
- **Start**: `npm run dev` (runs decrypt-modules-if-needed and build_orchestrator)
- **Development**: `npm run server:dev`
- **Build-only**: `npm run server:build`
- Full-stack with backend integration

### Markdown Preview Server (Separate)
- **Start**: `npm run dev:markdown`
- **Config**: `vite.markdown.config.ts`
- **Port**: 5174
- **Purpose**: Markdown preview functionality
- **Note**: This is a separate server from the main application

### Other Key Commands
- **Lint (TS/JS)**: `npm run lint`
- **Lint & Fix Rust**: `npm run lint:fix:rust`
- **Test TypeScript**: `npm run test`
- **Test Rust**: `npm run test:rust`
- **Test WASM**: `npm run test:wasm`
- Login password comes from `UNSAFE_LOCAL_USER_PASSWORD` in `.env.local`

## WindSurf Ignore Rules

The following paths should be ignored by WindSurf:
```
node_modules/
dist/
scripts/dist/
package-lock.json
coverage/
*.svg
*.csv
```

## Linting

After making changes on in Typescript/JavaScript, run:

```bash
npm run format   # oxfmt
npm run lint # Essentailly oxlint
```

### React Doctor

Run after making React changes to catch issues early. Use when reviewing code, finishing a feature, or fixing bugs in a React project.

Scans your React codebase for security, performance, correctness, and architecture issues. Outputs a 0-100 score with actionable diagnostics.

**Usage**

```bash
npx -y react-doctor@latest . --verbose --diff
```

### Workflow

Run after making changes to catch issues early. Fix errors first, then re-run to verify the score improved.
