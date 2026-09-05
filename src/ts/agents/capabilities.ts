import { allWebMCPTools, type WebMCPTool } from "./webmcp/registry";

export type AgentExecution = "read-only" | "mutation" | "blocked";
export type AgentRouteStatus =
  | "supported"
  | "authenticated"
  | "unsupported"
  | "non-agent";

export interface AgentToolCapability extends WebMCPTool {
  execution: AgentExecution;
  requiresHardware?: boolean;
}

export interface AgentRouteCapability {
  path: string;
  label: string;
  status: AgentRouteStatus;
  markdown?: string;
  notes: string;
}

const mutationTools = new Set([
  "setSourceMode",
  "connectDevice",
  "startCapture",
  "stopCapture",
  "setActiveArea",
  "setFrequencyRange",
  "setSpikeCount",
  "setSpikeWidth",
  "generateSignal",
  "createHotspot",
  "setSymmetryMode",
  "selectHotspot",
  "deleteHotspot",
  "importHotspots",
  "selectLocation",
  "addLocation",
  "removeLocation",
  "setGain",
]);

const blockedTools = new Set([
  "transmitSignal",
  "deleteDevice",
  "formatCaptureStore",
]);

const routeDefinitions: AgentRouteCapability[] = [
  {
    path: "/",
    label: "Visualizer",
    status: "supported",
    markdown: "visualizer.md",
    notes: "Spectrum, source, capture, and analysis tools.",
  },
  {
    path: "/visualizer",
    label: "Visualizer",
    status: "supported",
    markdown: "visualizer.md",
    notes: "Spectrum, source, capture, and analysis tools.",
  },
  {
    path: "/demodulate",
    label: "Demodulate",
    status: "supported",
    markdown: "analysis.md",
    notes:
      "Analysis tools are available; hardware operations require the CLI mutation opt-in.",
  },
  {
    path: "/demod",
    label: "Demodulate",
    status: "supported",
    markdown: "analysis.md",
    notes: "Alias of the demodulate route.",
  },
  {
    path: "/draw-signal",
    label: "Draw signal",
    status: "supported",
    markdown: "draw-signal.md",
    notes: "Signal-generation tools are exposed with mutation policy.",
  },
  {
    path: "/3d-model",
    label: "3D model",
    status: "supported",
    markdown: "3d-model.md",
    notes: "Model and hotspot tools.",
  },
  {
    path: "/map-endpoints",
    label: "Map endpoints",
    status: "supported",
    markdown: "map-endpoints.md",
    notes: "Location and endpoint tools.",
  },
  {
    path: "/prefs",
    label: "Preferences & Extras",
    status: "authenticated",
    notes: "No standalone Markdown contract; use authenticated app APIs.",
  },
  {
    path: "/iq-captures",
    label: "I/Q captures",
    status: "authenticated",
    notes: "Capture listing and downloads require an authenticated session.",
  },
  {
    path: "/learn",
    label: "Learn signals",
    status: "unsupported",
    notes: "Educational content is not an executable agent surface.",
  },
  {
    path: "/auth",
    label: "Authentication",
    status: "non-agent",
    notes: "Authentication UI is never driven by agent Markdown.",
  },
  {
    path: "/get-started",
    label: "Get started",
    status: "non-agent",
    notes: "Onboarding UI is not an agent tool surface.",
  },
  {
    path: "/terms",
    label: "Terms",
    status: "non-agent",
    notes: "Legal document route.",
  },
  {
    path: "/privacy",
    label: "Privacy",
    status: "non-agent",
    notes: "Legal document route.",
  },
  {
    path: "/license",
    label: "License",
    status: "non-agent",
    notes: "Legal document route.",
  },
];

const toCapability = (tool: WebMCPTool): AgentToolCapability => ({
  ...tool,
  execution: blockedTools.has(tool.name)
    ? "blocked"
    : mutationTools.has(tool.name)
      ? "mutation"
      : "read-only",
  requiresHardware: [
    "connectDevice",
    "startCapture",
    "stopCapture",
    "setGain",
  ].includes(tool.name),
});

export const agentCapabilities = {
  version: "2",
  routes: routeDefinitions,
  tools: [
    ...allWebMCPTools.map(toCapability),
    {
      name: "getDeviceStatus",
      description: "Read current device and source status",
      parameters: [],
      returns: { type: "object", description: "Current backend source status" },
      category: "Status",
      execution: "read-only" as const,
    },
    {
      name: "transmitSignal",
      description: "Transmit a signal (blocked for agent clients)",
      parameters: [],
      returns: { type: "object", description: "Never executed" },
      category: "Safety",
      execution: "blocked" as const,
    },
    {
      name: "signalsInspect",
      description: "Inspect local IQ or N-APT signal metadata",
      parameters: [{ name: "input", type: "string", required: true }],
      returns: {
        type: "object",
        description: "Signal metadata and sample counts",
      },
      category: "Signals",
      execution: "read-only" as const,
    },
    {
      name: "signalsCaptureRx",
      description: "Capture receive-only IQ data from an authorized SDR",
      parameters: [],
      returns: { type: "object", description: "Local capture result" },
      category: "Signals",
      execution: "mutation" as const,
      requiresHardware: true,
    },
  ] as AgentToolCapability[],
};

export function getAgentCapability(name: string) {
  return agentCapabilities.tools.find((tool) => tool.name === name);
}

export function getAgentRoute(path: string) {
  return agentCapabilities.routes.find((route) => route.path === path);
}

export function isToolAllowedForCli(name: string, allowMutations: boolean) {
  const tool = getAgentCapability(name);
  if (!tool || tool.execution === "blocked") return false;
  return tool.execution === "read-only" || allowMutations;
}
