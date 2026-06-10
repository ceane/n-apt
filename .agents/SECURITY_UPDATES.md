# Security Updates Summary

We resolved the security vulnerabilities listed in the package security report by adding/updating overrides in `package.json` to pull patched versions published before the registry cutoff date of June 3, 2026.

## Fixed Vulnerabilities

1. **Hono Framework Vulnerabilities**
   * **Issues:**
     * IP Restriction bypass for non-canonical IPv6 (CVE-2026-47674)
     * Prefix stripping mismatch using undecoded paths in `app.mount()` (CVE-2026-47676)
     * JWT middleware accepting any Authorization scheme (CVE-2026-47673)
     * Cookie helper injection due to unsanitized `sameSite` and `priority` (CVE-2026-47675)
   * **Fix:** Added `"hono": "^4.12.23"` to the `overrides` section of `package.json` to resolve these issues. Version `4.12.23` is the latest version published before the local June 3, 2026 registry cutoff.

2. **protobufjs Vulnerability**
   * **Issue:** Denial of Service via unbounded recursive JSON descriptor expansion (CVE-2026-45740).
   * **Fix:** Updated the `"protobufjs"` override version in `package.json` to `^7.6.2`, which includes the patch and matches the registry date cutoff.

3. **qs & ws Packages**
   * Verified that the existing overrides (`"qs": "^6.15.2"` and `"ws": "^8.21.0"`) are correct and target the patched versions for their respective vulnerabilities (CVE-2026-8723 and CVE-2026-45736).

## Verification Results

* Ran `npm run typecheck` - TS compiled successfully.
* Ran `npm test` - All 1,010 Jest unit tests and vitest shader tests passed successfully.
* Ran `cargo check` - Rust backend compiled successfully.
