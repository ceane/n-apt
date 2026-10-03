import packageJson from "../../package.json";

export type CliHelpTopic =
  | "root"
  | "devices"
  | "capture"
  | "capture-snapshot"
  | "capture-iq"
  | "signals"
  | "signals-inspect"
  | "signals-spectrum"
  | "signals-validate"
  | "signals-demod"
  | "signals-capture"
  | "agent"
  | "agent-capabilities"
  | "agent-tools"
  | "agent-markdown"
  | "agent-call"
  | "demod";

const helpText: Record<CliHelpTopic, string> = {
  root: `N-APT CLI ${packageJson.version}

Usage:
  npm run cli -- <command> [options]

Start services:
  npm run dev                  Start the Rust backend and frontend

Commands:
  devices                       List backend SDR and Mock APT sources
  capture snapshot              Render a PNG from live signal frames
  capture iq                    Record an I/Q capture artifact
  signals inspect <input>       Inspect raw I/Q or NAPT-IQ3 metadata
  signals spectrum <input>      Summarize signal magnitude statistics
  signals validate <input>      Validate signal metadata
  signals demod <input>         Demodulate raw I/Q into an I/Q artifact
  signals capture               Alias for capture iq
  agent capabilities            Print advertised routes and agent tools
  agent tools                   Print advertised agent tools
  agent markdown                Fetch route-aware Markdown
  agent call <tool>             Execute an authenticated agent tool
  demod <input>                 Direct alias for signals demod

Global options:
  -h, --help                    Show help without starting services
      --version                 Print the CLI version

Option syntax:
  --option <value>              Set a value option
  --option=value                Equivalent equals-form syntax
  Boolean options take no value. Unknown, duplicate, or incomplete options fail
  with exit status 2 before command side effects.

Command help:
  npm run cli -- <command> --help
  npm run cli -- help capture iq

Environment:
  N_APT_BACKEND_URL              Backend URL (default http://localhost:8765)
  N_APT_FRONTEND_URL             Frontend URL (default http://localhost:5173)
  N_APT_SESSION_TOKEN            Existing backend session token
  N_APT_ASPECT_PATH              Mounted Aspect folder for capture artifacts
  UNSAFE_LOCAL_USER_PASSWORD     Local backend authentication password`,
  devices: `Usage:
  npm run cli -- devices [--json]

List the source IDs, names, kinds, states, and serials reported by the Rust
backend. This command requires only the backend service.

Options:
  --json                         Print a versioned machine-readable source inventory
  -h, --help                     Show this help without starting services`,
  capture: `Usage:
  npm run cli -- capture snapshot [options]
  npm run cli -- capture iq [options]

Commands:
  snapshot                       Render a PNG using the headless canvas (backend + frontend)
  iq                             Record and download a capture artifact (backend only)

Options:
  --device auto|<device-id>      Select a source (default: auto)
  --interactive                  Prompt when multiple physical SDRs are connected
  --fft-size <points>            Power-of-two FFT size (default: 65536)
  --gain <dB>                    Source gain value shown or requested
  --ppm <value>                  Source frequency correction shown or requested
  --output <path>                Output artifact path
  -h, --help                     Show this help without starting services

Run capture snapshot --help or capture iq --help for command-specific options.`,
  "capture-snapshot": `Usage:
  npm run cli -- capture snapshot [options]

Options:
  --device auto|<device-id>      Select a source (default: auto)
  --interactive                  Prompt when multiple physical SDRs are connected
  --waterfall                    Include waterfall history
  --grid                         Draw the frequency and power grid
  --stats                        Include capture and device statistics
  --theme dark|light             Select colors (default: dark)
  --fft-size <points>            Power-of-two FFT size (default: 65536)
  --gain <dB>                    Gain shown in snapshot metadata
  --ppm <value>                  PPM shown in snapshot metadata
  --output <path>                PNG path (default: ~/Downloads/n-apt_snapshot_<timestamp>.png)
  -h, --help                     Show this help without starting services

This command requires both the Rust backend and frontend renderer. It requests
one live frame normally and 64 frames only when waterfall history is enabled.`,
  "capture-iq": `Usage:
  npm run cli -- capture iq [options] --allow-mutations

Options:
  --allow-mutations              Required acknowledgement before capture starts
  --device auto|<device-id>      Select a source (default: auto)
  --interactive                  Prompt when multiple physical SDRs are connected
  --center-frequency <Hz>        Target center; capture may retune the radio
  --sample-rate <Hz>             Concrete sample rate applied and acknowledged
  --duration-mode timed|manual   Acquisition duration mode (default: timed)
  --duration <seconds>           Timed duration (default: 1)
  --acquisition-mode <mode>      stepwise, interleaved, or whole_sample
  --quality-profile <name>       Resolve concrete preflight options for the selected profile
  --fft-size <points>            Concrete FFT size applied and acknowledged
  --fft-window <name>            Concrete FFT window applied and acknowledged
  --frame-rate <fps>             Concrete frame rate applied and acknowledged
  --file-type <type>             .napt, .wav, or .iq (default: .napt)
  --encrypted                    Encrypt WAV output; .napt is always encrypted
  --gain <dB>                    Requested gain; the worker records the active value
  --ppm <value>                  Requested PPM; the worker records the active value
  --output <path>                Download path (default: ~/Downloads/<backend filename>)
  --destination local|aspect     Save destination (remembered; default: local)
  -h, --help                     Show this help without starting services

This command requires only the Rust backend. The backend applies the resolved
sample rate, FFT size, FFT window, and frame rate, then acknowledges the actual
values before the CLI accepts the capture. Downloaded .iq/.napt artifacts must
pass V6, checksum, integrity, and patch-history verification. The --destination
choice is remembered in ~/.n-apt.json, which stores only the destination id.
Aspect requires N_APT_ASPECT_PATH to point to an already-mounted folder.`,
  signals: `Usage:
  npm run cli -- signals <operation> [input] [options]

Operations:
  inspect <input>                Inspect raw I/Q or NAPT-IQ3 metadata
  spectrum <input>               Print magnitude statistics for the input
  validate <input>               Validate metadata required for demodulation
  demod <input>                  Demodulate raw I/Q
  capture [options]              Alias for capture iq; requires --allow-mutations

Options:
  --input <path>                 Input file (alternative to the positional input)
  --json                         Pretty-print JSON where supported
  -h, --help                     Show command help without doing work`,
  "signals-inspect": `Usage:
  npm run cli -- signals inspect <input> [--json]
  npm run cli -- signals inspect --input <path> [--json]

Options:
  --input <path>                 Input file
  --json                         Pretty-print the result
  -h, --help                     Show this help without reading a file`,
  "signals-spectrum": `Usage:
  npm run cli -- signals spectrum <input> [--json]
  npm run cli -- signals spectrum --input <path> [--json]

Prints byte-pair magnitude statistics. This command does not currently compute
an FFT spectrum.

Options:
  --input <path>                 Input file
  --json                         Pretty-print the result
  -h, --help                     Show this help without reading a file`,
  "signals-validate": `Usage:
  npm run cli -- signals validate <input> [--json]
  npm run cli -- signals validate --input <path> [--json]

Exits with status 1 when required metadata is invalid.

Options:
  --input <path>                 Input file
  --json                         Pretty-print the result
  -h, --help                     Show this help without reading a file`,
  "signals-demod": `Usage:
  npm run cli -- signals demod <input> [options]
  npm run cli -- signals demod --input <path> [options]

Options:
  --input <path>                 Raw I/Q input file
  --output <path>                Output path (default: demodulated.iq)
  --center-frequency <Hz>        Center frequency (default: 0)
  --min-frequency <Hz>           Minimum frequency
  --max-frequency <Hz>           Maximum frequency
  --sample-rate <Hz>             Input sample rate (default: 2400000)
  --algorithm <name>             fm, fmDiscriminator, aptAudio, or aptImage
  -h, --help                     Show this help without reading a file`,
  "signals-capture": `Usage:
  npm run cli -- signals capture [options] --allow-mutations

Signals capture is an alias for capture iq. Run the following for its full
option list:

  npm run cli -- capture iq --help`,
  agent: `Usage:
  npm run cli -- agent <command> [options]

Commands:
  capabilities [--json]          Print advertised routes and tools
  tools [--json]                 Print advertised tools
  markdown [options]             Fetch route-aware Markdown
  call <tool> [options]          Execute an authenticated backend tool`,
  "agent-capabilities": `Usage:
  npm run cli -- agent capabilities [--json]

Options:
  --json                         Pretty-print the capability manifest
  -h, --help                     Show this help without starting services`,
  "agent-tools": `Usage:
  npm run cli -- agent tools [--json]

Options:
  --json                         Pretty-print the capability manifest
  -h, --help                     Show this help without starting services`,
  "agent-markdown": `Usage:
  npm run cli -- agent markdown [--route <path>] [--json]

Options:
  --route <path>                 Frontend route (default: /)
  --json                         Wrap the response in a JSON envelope
  -h, --help                     Show this help without starting services

This command requires only the frontend service.`,
  "agent-call": `Usage:
  npm run cli -- agent call <tool> [--params <json>] [--allow-mutations] [--json]

Options:
  --params <json>                Tool parameters as JSON (default: {})
  --allow-mutations              Acknowledge a state-changing tool
  --json                         Pretty-print the tool result
  -h, --help                     Show this help without starting services

This command requires only the Rust backend. A backend response with
"success": false exits nonzero.`,
  demod: `Usage:
  npm run cli -- demod <input> [options]
  npm run cli -- demod --input <path> [options]

Options:
  --input <path>                 Raw I/Q input file
  --output <path>                Output path (default: demodulated.iq)
  --center-frequency <Hz>        Center frequency (default: 0)
  --min-frequency <Hz>           Minimum frequency
  --max-frequency <Hz>           Maximum frequency
  --sample-rate <Hz>             Input sample rate (default: 2400000)
  --algorithm <name>             fm, fmDiscriminator, aptAudio, or aptImage
  -h, --help                     Show this help without reading a file`,
};

function topicFor(args: readonly string[]): CliHelpTopic {
  const command = args[0];
  const operation = args[1];
  if (command === "devices") return "devices";
  if (command === "capture") {
    if (operation === "snapshot") return "capture-snapshot";
    if (operation === "iq") return "capture-iq";
    return "capture";
  }
  if (command === "signals") {
    if (operation === "inspect") return "signals-inspect";
    if (operation === "spectrum") return "signals-spectrum";
    if (operation === "validate") return "signals-validate";
    if (operation === "demod") return "signals-demod";
    if (operation === "capture") return "signals-capture";
    return "signals";
  }
  if (command === "agent") {
    if (operation === "capabilities") return "agent-capabilities";
    if (operation === "tools") return "agent-tools";
    if (operation === "markdown") return "agent-markdown";
    if (operation === "call") return "agent-call";
    return "agent";
  }
  if (command === "demod") return "demod";
  return "root";
}

export function resolveCliHelpTopic(
  args: readonly string[],
): CliHelpTopic | undefined {
  if (args.length === 0) return "root";
  if (args[0] === "help") return topicFor(args.slice(1));
  if (args[0] === "devices" && args[1] === "help") return "devices";
  if (args[0] === "capture" && args[1] === "help") return "capture";
  if (args[0] === "signals" && args[1] === "help") return "signals";
  if (args[0] === "agent" && args[1] === "help") return "agent";
  if (args.includes("--help") || args.includes("-h")) return topicFor(args);
  return undefined;
}

export function renderCliHelp(topic: CliHelpTopic): string {
  return helpText[topic];
}

export function cliVersion(): string {
  return packageJson.version;
}
