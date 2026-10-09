#!/usr/bin/env node
import { runProtectedMlEntrypoint } from "../encrypted-modules/mlCliShim.mjs";

try {
  process.exitCode = runProtectedMlEntrypoint("node", "scripts/classifier/cli.mjs");
} catch (error) {
  console.error(`Encrypted ML modules are unavailable: ${error.message}`);
  process.exitCode = 1;
}
