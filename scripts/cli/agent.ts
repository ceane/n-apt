import { agentCapabilities, getAgentCapability, isToolAllowedForCli } from "../../src/ts/agents/capabilities";

export type CliToolDecision = { allowed: true } | { allowed: false; reason: "unknown" | "blocked" | "mutation_requires_opt_in" };

export function evaluateCliToolRequest(name: string, allowMutations: boolean): CliToolDecision {
  const tool = getAgentCapability(name);
  if (!tool) return { allowed: false, reason: "unknown" };
  if (tool.execution === "blocked") return { allowed: false, reason: "blocked" };
  if (!isToolAllowedForCli(name, allowMutations)) return { allowed: false, reason: "mutation_requires_opt_in" };
  return { allowed: true };
}

export function printAgentCapabilities(json: boolean) {
  const value = { version: agentCapabilities.version, routes: agentCapabilities.routes, tools: agentCapabilities.tools };
  if (json) console.log(JSON.stringify(value, null, 2));
  else {
    console.log(`Agent capability manifest v${value.version}`);
    value.routes.forEach((route) => console.log(`${route.path.padEnd(22)} ${route.status.padEnd(14)} ${route.label}`));
    console.log(`\nTools: ${value.tools.length}`);
  }
}

export async function fetchAgentMarkdown(baseUrl: string, route: string) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${route}`, { headers: { Accept: "text/markdown" } });
  const body = await response.text();
  if (!response.ok) throw new Error(`Markdown request failed: HTTP ${response.status}`);
  return { route, status: response.status, contentType: response.headers.get("content-type"), tokens: response.headers.get("x-markdown-tokens"), body };
}

export async function executeAgentTool(baseUrl: string, token: string, name: string, params: unknown, allowMutations: boolean) {
  const decision = evaluateCliToolRequest(name, allowMutations);
  if (!decision.allowed) throw new Error(`Tool ${name} rejected: ${decision.reason}`);
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/webmcp/execute`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ name, params }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Tool request failed: HTTP ${response.status}`);
  return result;
}
