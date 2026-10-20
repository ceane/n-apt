# Connection Allowlist

The Vite development and preview servers attach a `Connection-Allowlist`
response header to served resources. The policy allows the response origin,
the configured browser backend and its matching WebSocket origin, Google Fonts,
Nominatim, CARTO basemap tiles, and Hugging Face model downloads. The Rust
backend also attaches `Connection-Allowlist: (response-origin)` to its HTTP
responses. Keep these policies aligned with intentional browser-initiated
network requests when adding integrations.

The header follows the [WICG Connection Allowlists draft](https://wicg.github.io/connection-allowlists/),
which is not a W3C Standard. Vite protects app documents and workers during
development and preview. The Rust header protects documents and workers served
by Rust; it does not set the policy of a separately served Vite/GitHub Pages
document. GitHub Pages serves static files and cannot set this response header,
so a production host with response-header configuration is needed before the
policy can protect that deployment.
