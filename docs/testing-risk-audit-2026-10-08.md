# Test risk audit — October 8, 2026

## Actioned in this pass

- Added invalid UTF-8 source-ID handling and a regression plus valid-frame
  single-field mutation property for the v2 IQ envelope decoder.
- Replaced the WebSocket export test's return-type-only checks with explicit
  valid-message acceptance and unknown-message rejection.
- Isolated Redis setup fixtures from the developer's Redis service and corrected
  the setup test to check preservation of existing credentials instead of
  requiring byte-for-byte preservation of the whole environment file.
- Added a runnable security-script test command and CI job, and added the
  existing endpoint authorization suite to the Rust CI target list. Kept its
  temporary HOME directory alive through each test and restored HOME on drop.

The remaining worthwhile work is broader transport-level rejection/state
assertions, representative parser fuzzing, and measured performance baselines.
GPU browser specs need an appropriate runner before they are made required. The
small component and migration tests are low-priority cleanup; removing them
would save little compared with fixing the performance test oracles.

## Scope and conclusion

Reviewed test discovery, CI selection, representative frontend and Rust tests,
property generators, security regressions, and pipeline benchmarks against the
current working tree. This is a targeted audit, not an exhaustive execution of
every test. Existing concurrent implementation edits were preserved.

The highest return is to run existing security tests, improve the assertions and
input distributions in existing properties, and measure real pipeline work.
Adding component smoke tests or increasing global coverage would not address
these gaps. Test value should be judged by the harmful change it detects.

## CI gaps and completed wiring

- `endpoint_auth_tests` now runs in the authenticated Rust CI lane. Its fixture
  retains the temporary home through server teardown and restores the prior
  process environment.
- There is no Playwright job in that workflow. `Logout.spec.ts`, `VaultE2E.spec.ts`,
  `fft_power_gpu.integration.spec.ts`, and `napt_classifier_gpu.spec.ts` are not
  selected by Jest. Add a browser lane; report unavailable GPU adapters as an
  explicit missing capability, and require an adapter in the designated GPU job.
- `test:security-scripts` now runs the setup, archive-server, and Vite security
  suites, and is included in `test:all` and its own CI job. The 16 tests passed
  locally after setup fixtures were isolated from any running Redis instance.
- The V6 writer/reader test in `iqCaptureCrossLanguage.test.ts` is skipped unless
  `NAPT_IQ_CROSS_LANGUAGE_FIXTURE` is supplied. CI does not run the existing
  `test:iq-capture:cross-language` command. Run it explicitly with generated
  backend output rather than treating a skipped frontend test as coverage.
- CI's `cargo bench --bench pipeline_benchmarks --no-run` only compiles benchmarks.
  Run and archive measurements in a separate benchmark lane.
- CI uploads coverage without invoking frontend coverage or Rust instrumentation.
  Upload steps do not establish that a fresh coverage report was produced.

## Trim, move, or replace

| Current test | Assessment | Action |
| --- | --- | --- |
| `test/ts/validation-exports.test.ts` | Export/type checks; both valid and invalid messages need only return a boolean. An always-accepting validator passes those checks. | Delete redundant export checks; require explicit accept/reject outcomes in boundary tests. |
| `test/ts/performanceCriticalPatterns.test.ts` | Bans `.map`, `.filter`, `.reduce`, `.forEach`, and `DataView` anywhere in selected source files. It does not measure cost or allocations. | Replace with actual frame-processing/allocation benchmarks; retain an independently justified rule as lint only. |
| `test/ts/NodeContainer.test.tsx` | Three checks for rendering supplied children, an attribute, or any element. | Remove or consolidate into an existing meaningful workflow test if the attribute is operationally required. |
| `test/ts/MetadataNode.test.tsx` | Pins placeholder wording through a helper. | Consolidate; retain a workflow assertion that corrupt input does not appear as usable data. |
| `test/ts/componentArchitecture.test.ts` | Mixes useful dependency-boundary rules with retired-directory and literal-config checks. | Move structural rules into the lint lane; retire completed migration checks after ensuring equivalent build/import enforcement. |
| `test/ts/nativeClassifierAdversarial.test.ts` | Synthetic diagnostic test checks feature length, positive resolution, and ready status; logs several scores without testing discrimination. | Keep as report tooling or strengthen numerical/morphology invariants. Do not present synthetic shapes as real-signal accuracy evidence. |
| `test/rust/performance_tests.rs`, frame-rate stability across sizes | Calculates expected cadence, then sleeps to simulate work. Primarily measures the scheduler. | Keep deterministic ceiling math; replace the sleep loop with actual processing and end-to-end cadence measurements. |
| `test/ts/property/liveSourcePause.property.test.ts`, label properties | Random booleans cover only four/eight combinations. | Use an exhaustive table for labels; retain random transition sequences where state history matters. |

Do not delete behavioral tests solely because they use React or test a small
function. Authentication, TX interlocks, source ownership, stale-frame rejection,
cleanup, DSP numerics, and capture integrity can warrant focused tests.

## Strengthen existing fuzz/property tests

1. **Generate valid messages first, then mutate one field.** In
   `websocketValidation.property.test.ts`, the test named “accepts exactly” only
   checks the return type. Its valid-round-trip property returns immediately for
   rejected inputs. Add per-message valid generators, boundary violations,
   required-field deletion, and explicit expected verdicts. Count cases reaching
   each message variant so vacuous success is visible.
2. **Test rejection effects.** `stream_command_proptests.rs`'s
   `garbage_stream_options_never_corrupt_mode` only attempts deserialization;
   it does not inspect device state. Apply malformed commands through the real
   handler and assert no device mutation, no TX start, and no subscription leak.
   Separate valid options from arbitrary options in “honest” command generators.
3. **Exercise the named fields.** The `bandwidth_hz_deserialization...` property in
   `ws_message_proptests.rs` does not explicitly construct `bandwidthHz` settings
   messages. Generate these shapes and cover fractional, negative, overflowing,
   string, null, missing, and exact-boundary values.
4. **Mutate valid IQ frames.** Uniform random bytes almost never reach the v2
   branch: its four-byte magic alone is exceedingly unlikely. Start from valid
   frames and mutate header/source lengths, UTF-8, version, freshness, status,
   sample rate, data type, payload truncation, and u64 precision boundaries.
   Assert exact metadata/payload preservation and zero-copy payload views.
5. **Preserve cross-language differences.** Rust codec properties cover full u64
   epochs/sequences while the browser rejects values above `MAX_SAFE_INTEGER`.
   Use a shared corpus to pin the intended acceptance boundary rather than
   assuming successful Rust round trips establish browser compatibility.
6. **Extend stateful properties through real transports.** Existing stream-manager
   properties are worth keeping. Add generated subscribe/pause/retune/disconnect/
   revoke sequences, lagging consumers, and producer restarts. Check isolation,
   monotonically accepted epochs, bounded queues, and cleanup after cancellation.
   Use a small independent reference model rather than copying production logic.

### Concrete malformed-input gap

An otherwise valid v2 frame with a one-byte source ID of `0xff` causes
`decodeIqFrameEnvelope` to throw a raw `TypeError` from its fatal UTF-8 decoder.
The existing arbitrary-byte property expects documented `Invalid I/Q frame`
errors but does not reliably generate this near-valid input. Reproduced against
the production decoder with a 58-byte frame. Normalize malformed UTF-8 errors
and add this input to the regression corpus. This demonstrates an error-contract
gap; it does not by itself establish an exploitable vulnerability.

## New methods with meaningful oracles

- **Coverage-guided fuzzing:** add bounded Rust fuzz targets for production capture
  parsing, decryption-envelope parsing, and WS/control decoding. Seed them with
  real format fixtures and previous failures. Keep deterministic properties on
  PRs; run time-budgeted fuzzing nightly with sanitizer builds where supported.
  Save minimized crashing inputs and convert failures into regressions.
- **Authorization matrix:** exercise real routes with missing, malformed, expired,
  revoked, and valid sessions; test ambiguous header/query credentials and
  cross-session challenge use. Assert no mutation or artifact creation on denial.
- **Resource exhaustion:** send over-limit/fragmented WS messages, deep JSON,
  archive expansion attacks, excessive subscriptions, and slow readers. Assert
  bounded queue/memory growth, timely cancellation, and healthy unrelated clients.
  Existing WS/body limits and archive tests are a starting point, not evidence
  that every path is protected under load.
- **Capture integrity:** mutate header, wrapped key, ciphertext, tag, offsets, and
  section lengths through actual readers. Check authentication failure, bounded
  allocation, no partial accepted output, and preservation of capture salts.
  Extend existing tamper tests rather than duplicating their happy paths.
- **Performance:** extend Criterion coverage to serialization/encryption, fanout,
  queue handoff, capture write/read, and mixed FFT sizes. Measure p50/p95/p99
  command-to-accepted-frame latency, bytes copied, allocation counts, drops, and
  queue high-water marks. Include warm/cold runs and 1/many/slow subscribers.
  Gate deterministic resource bounds on PRs; use stable hardware and repeatable
  baselines for performance regression gates instead of tight shared-VM timings.
- **Browser soak:** repeatedly retune, pause, switch sources, and remount real GPU
  pipelines. Require no stale-source presentation, GPU validation errors, or
  sustained resource growth; compare computed outputs against independent DSP
  references with explicit tolerances.
- **Targeted mutation testing:** deliberately bypass authorization, disable a
  validator, drop epoch checks, or remove extraction limits in isolated copies.
  Require the relevant tests to fail. Start with these critical modules rather
  than adopting a repository-wide mutation or coverage quota.

## Suggested order

1. Run the V6 cross-language contract in CI and decide which Playwright checks
   can run on an available browser/GPU runner.
2. Replace the vacuous WebSocket/control-message properties with generated valid
   messages, targeted mutations, and state-effect assertions.
3. Replace syntax and sleep-based performance checks with real measured pipeline
   work and stable resource bounds.
4. Add bounded parser fuzz targets and slow-consumer/resource-exhaustion cases.
5. Trim migration/UI smoke tests only where those checks have no useful user or
   architectural contract to protect.

## Execution evidence

- Selected Jest run from the audit: **13 suites, 93 tests passed**. After the
  decoder fix and stronger export assertions: **2 suites, 13 tests passed**.
- Production-decoder malformed UTF-8 reproduction failed before the fix with a
  raw `TypeError`; the documented protocol-error regression now passes.
- `npm run typecheck` passed.
- Script security run after isolating the setup fixtures: **16 passed, 0 failed**
  across archive handling, Vite serving, and setup security. Vite printed its
  config-loader warning; all three private-file checks passed.
- `cargo test --profile dev-incremental --test endpoint_auth_tests`: **16 passed,
  0 failed, 0 ignored**. The compile reported an existing unused-method warning
  in the dirty `src/rs/server/shared_state.rs`; it did not fail the test.
- Package JSON and workflow YAML parse checks passed. Rust formatting check for
  the whole existing endpoint test file reports pre-existing formatting
  differences outside the new guard code.
- Browser E2E, hardware tests, and benchmarks were inspected but not run.
