# Security Policy

## Scope

This policy covers the n-apt source repository, its Rust backend, TypeScript
frontend, WebSocket endpoints, WASM modules, build scripts, and published
packages or binaries maintained from this repository.

I/Q captures and related recordings are especially sensitive. Do not include
captures, credentials, private keys, or other personal data in a report or
pull request. Share the smallest reproducible artifact possible, preferably a
synthetic fixture or a redacted log.

Never upload captures or derived artifacts to AI tools, security scanners,
issue trackers, or other cloud services. Avoid exposing capture filenames,
metadata, filesystem paths, logs, screenshots, recordings, or crash dumps when
they could identify a person, place, device, or recording environment.

Do not decrypt, copy, transform, or export captures unless necessary for the
requested task. Keep temporary derivatives outside the repository and remove
them after use when they are no longer needed. Use synthetic fixtures or
redacted excerpts for tests, bug reports, and reproductions whenever possible.

## Supported versions

Security fixes are generally made against the default branch and the most
recent release. Older versions may not receive backports.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub's repository
security advisory / private vulnerability reporting flow for
[ceane/n-apt](https://github.com/ceane/n-apt/security/advisories).

If that flow is unavailable, contact the maintainer through the contact method
listed on the [repository owner profile](https://github.com/ceane) and request
a private security channel. Do not open a public issue for an undisclosed
vulnerability.

Include, when safe to share:

- the affected version, commit, or deployment;
- the component and vulnerability type;
- clear reproduction steps or a minimal proof of concept;
- the security impact and any prerequisites; and
- suggested mitigation, if known.

Please allow time for confirmation, remediation, and coordinated disclosure.
We will acknowledge valid reports, keep the reporter informed when practical,
and credit reporters who want attribution.

## Automated findings and triage

CodeQL alerts and Aikido findings are treated as security signals, not as
automatic proof of exploitability. Maintainers should reproduce or otherwise
validate each finding, identify the affected data flow and reachable
deployment, and record the decision to fix, mitigate, defer, or dismiss.

- **CodeQL:** review alerts in the repository's GitHub Security tab, prioritize
  reachable high-impact flows, and retain the alert reference in the change or
  triage record.
- **Aikido:** review the trial workspace findings for dependency, secret,
  SAST, and infrastructure exposure; verify that the finding maps to this
  repository and is not a duplicate of a CodeQL alert.
- **Dependencies and secrets:** rotate exposed credentials immediately, avoid
  committing secrets while reproducing a finding, and use lockfile-aware
  updates for dependency fixes.

Automated scanners do not replace review of authentication, authorization,
WebSocket input validation, file/capture handling, cryptography, or native
device boundaries.

## Disclosure

Please keep vulnerability details private until a fix or mitigation is
available and a disclosure date has been agreed with the maintainer. Public
security advisories should include affected versions, fixed versions or
mitigations, and upgrade guidance without exposing sensitive captures or
credentials.
