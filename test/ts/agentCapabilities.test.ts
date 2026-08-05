import {
  agentCapabilities,
  getAgentCapability,
  getAgentRoute,
  isToolAllowedForCli,
} from "../../src/ts/agents/capabilities";

describe("agent capability manifest", () => {
  test("advertises every WebMCP tool with an execution policy", () => {
    expect(agentCapabilities.tools.length).toBeGreaterThan(0);
    expect(agentCapabilities.tools.every((tool) => tool.execution)).toBe(true);
    expect(new Set(agentCapabilities.tools.map((tool) => tool.name)).size).toBe(
      agentCapabilities.tools.length,
    );
  });

  test("gives every application route an explicit coverage status", () => {
    expect(agentCapabilities.routes.length).toBeGreaterThan(10);
    expect(agentCapabilities.routes.every((route) => route.status)).toBe(true);
    expect(getAgentRoute("/settings")?.status).toBe("authenticated");
    expect(getAgentRoute("/faq")?.status).toBe("unsupported");
  });

  test("allows read-only CLI tools and protects mutations by default", () => {
    expect(getAgentCapability("getDeviceStatus")?.execution).toBe("read-only");
    expect(isToolAllowedForCli("getDeviceStatus", false)).toBe(true);
    expect(isToolAllowedForCli("setGain", false)).toBe(false);
    expect(isToolAllowedForCli("setGain", true)).toBe(true);
    expect(isToolAllowedForCli("transmitSignal", true)).toBe(false);
  });
});
