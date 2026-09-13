import path from "node:path";

export function isProjectBuildOrchestratorCommand(
  command: string,
  expectedScriptPath = path.resolve(
    process.cwd(),
    "scripts/build/build-orchestrator.tsx",
  ),
  commandCwd?: string,
): boolean {
  const normalizedCommand = command.replace(/\\/g, "/");
  const normalizedScript = expectedScriptPath.replace(/\\/g, "/");
  if (normalizedCommand.includes(normalizedScript)) return true;
  if (!commandCwd) return false;

  const projectRoot = path.dirname(path.dirname(path.dirname(expectedScriptPath)));
  const relativeScript = path
    .relative(projectRoot, expectedScriptPath)
    .replace(/\\/g, "/");
  return (
    normalizedCommand.includes(relativeScript) &&
    path.resolve(commandCwd, relativeScript) === expectedScriptPath
  );
}
