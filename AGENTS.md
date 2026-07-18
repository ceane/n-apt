# AGENTS

## Mock APT SDR Rules

- Any work touching Mock APT SDR generation, buffering, reload behavior, or checksum-sensitive tests must preserve and verify the established Mock APT waveform checksum unless the change is explicitly intended to update the baseline.
- Do not accept a Mock APT change that alters frame continuity, introduces periodic gaps, or causes the generator to restart/reseed without an explicit test update and checksum review.
- When Mock APT changes affect the hot path, run the relevant Rust checks and compare the continuity/seeded checksum tests before and after.

## Temporary and Test Files

- Do not create unnecessary test or temporary files in the codebase.
- Any temporary files, mockups, or experimental scripts MUST be named explicitly using prefixes like `temp_`, `tmp_`, `test_`, or `fix_` (e.g., `temp_debug_helper.js`, `fix_build_error.sh`) or end with `.diff` (e.g., `patch.diff`) so that they are automatically excluded by Git.
- Avoid committing any random scratch files. Keep the git workspace clean.
- Never add I/Q capture data to Git. This includes `.napt`, `.wav`, `.iq`, and related capture extensions such as `.iq.u8`; keep captures local or in external storage and use metadata/manifests without the raw samples for versioned tests.

## Automated Testing

- When viewing the site via automated testing, you must visit from `localhost`. `127.0.0.1` is blocked.
