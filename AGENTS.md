# AGENTS

## Mock APT SDR Rules

- Any work touching Mock APT SDR generation, buffering, reload behavior, or checksum-sensitive tests must preserve and verify the established Mock APT waveform checksum unless the change is explicitly intended to update the baseline.
- Do not accept a Mock APT change that alters frame continuity, introduces periodic gaps, or causes the generator to restart/reseed without an explicit test update and checksum review.
- When Mock APT changes affect the hot path, run the relevant Rust checks and compare the continuity/seeded checksum tests before and after.
