# Get Started

`/get-started` is the app's onboarding page. It presents cards that take a user
to the main spectrum workspace, connected SDR sources, I/Q playback, the 3D
hardware gallery, and the interactive signal lessons. It also links to Terms
of Use and the Privacy Policy, and includes an external N-APT information link.

## Start a workflow

- **Take an I/Q Capture** opens the visualizer with its capture section
  selected. An SDR is required for live capture.
- **Use app** opens the visualizer. Its **Bypass Start Page Next Time** toggle
  controls whether onboarding is skipped on a later visit.
- **View signals via SDRs** opens the visualizer and shows connected physical
  sources when they are available. If none are connected, the card says so.
- **Playback I/Q Captures** opens a multi-file picker for `.napt`, `.iq`,
  `.wav`, and `.enc` files, switches the app to file mode, and sends the user
  to the visualizer. Protected `.enc` playback requires an authenticated
  backend session.
- **See hardware gallery** opens `/3d-model-gallery`.
- **Learn more about signals** opens `/learn`.

The page itself does not capture, inspect, or upload files. Selecting a file
from its playback card registers the selected local files with the app for
playback; handle those files as user-provided data.

## Agent access

This is an onboarding route, not an executable tool surface. The page provides
navigation and a local preference toggle; it does not expose WebMCP tools. Its
Markdown guide is descriptive and does not authorize acting on behalf of the
user or selecting local files.
