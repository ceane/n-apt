import { CLI_CAPTURE_DESTINATION_IDS } from "@n-apt/capture/destinations";

type OptionKind = "boolean" | "string" | "number";

type OptionSpec = {
  kind: OptionKind;
  choices?: readonly string[];
  integer?: boolean;
  positive?: boolean;
};

type InvocationSpec = {
  options: Readonly<Record<string, OptionSpec>>;
  argumentOffset: number;
  maxPositionals: number;
};

export class CliUsageError extends Error {
  readonly code = "invalid_usage";
  readonly exitCode = 2;

  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

const booleanOption: OptionSpec = { kind: "boolean" };
const stringOption: OptionSpec = { kind: "string" };
const finiteNumber: OptionSpec = { kind: "number" };
const positiveInteger: OptionSpec = {
  kind: "number",
  integer: true,
  positive: true,
};
const positiveNumber: OptionSpec = { kind: "number", positive: true };

const signalInputOptions: Record<string, OptionSpec> = {
  "--input": stringOption,
  "--json": booleanOption,
};

const demodOptions: Record<string, OptionSpec> = {
  ...signalInputOptions,
  "--output": stringOption,
  "--center-frequency": finiteNumber,
  "--min-frequency": finiteNumber,
  "--max-frequency": finiteNumber,
  "--sample-rate": positiveNumber,
  "--algorithm": {
    kind: "string",
    choices: ["fm", "fmDiscriminator", "aptAudio", "aptImage"],
  },
};

const snapshotOptions: Record<string, OptionSpec> = {
  "--device": stringOption,
  "--interactive": booleanOption,
  "--waterfall": booleanOption,
  "--grid": booleanOption,
  "--stats": booleanOption,
  "--theme": { kind: "string", choices: ["dark", "light"] },
  "--fft-size": positiveInteger,
  "--gain": finiteNumber,
  "--ppm": finiteNumber,
  "--output": stringOption,
};

const iqCaptureOptions: Record<string, OptionSpec> = {
  "--allow-mutations": booleanOption,
  "--device": stringOption,
  "--interactive": booleanOption,
  "--center-frequency": positiveNumber,
  "--sample-rate": positiveInteger,
  "--duration-mode": {
    kind: "string",
    choices: ["timed", "manual"],
  },
  "--duration": positiveNumber,
  "--acquisition-mode": {
    kind: "string",
    choices: ["stepwise", "interleaved", "whole_sample"],
  },
  "--quality-profile": {
    kind: "string",
    choices: ["iq-capture-cli", "demodulation", "classifier-training"],
  },
  "--fft-size": positiveInteger,
  "--fft-window": {
    kind: "string",
    choices: [
      "rectangular",
      "hanning",
      "hann",
      "hamming",
      "blackman",
      "nuttall",
    ],
  },
  "--file-type": {
    kind: "string",
    choices: [".napt", ".wav", ".iq"],
  },
  "--encrypted": booleanOption,
  "--gain": finiteNumber,
  "--ppm": finiteNumber,
  "--output": stringOption,
  "--destination": { kind: "string", choices: CLI_CAPTURE_DESTINATION_IDS },
  "--frame-rate": positiveInteger,
};

function specFor(args: readonly string[]): InvocationSpec {
  const command = args[0];
  const operation = args[1];
  if (command === "devices") {
    return {
      options: { "--json": booleanOption },
      argumentOffset: 1,
      maxPositionals: 0,
    };
  }
  if (command === "capture") {
    if (operation === "snapshot") {
      return {
        options: snapshotOptions,
        argumentOffset: 2,
        maxPositionals: 0,
      };
    }
    if (operation === "iq") {
      return {
        options: iqCaptureOptions,
        argumentOffset: 2,
        maxPositionals: 0,
      };
    }
    return { options: {}, argumentOffset: 2, maxPositionals: 0 };
  }
  if (command === "signals") {
    if (operation === "capture") {
      return {
        options: iqCaptureOptions,
        argumentOffset: 2,
        maxPositionals: 0,
      };
    }
    if (operation === "demod") {
      return {
        options: demodOptions,
        argumentOffset: 2,
        maxPositionals: 1,
      };
    }
    if (
      operation === "inspect" ||
      operation === "spectrum" ||
      operation === "validate"
    ) {
      return {
        options: signalInputOptions,
        argumentOffset: 2,
        maxPositionals: 1,
      };
    }
    return { options: {}, argumentOffset: 2, maxPositionals: 0 };
  }
  if (command === "agent") {
    if (operation === "capabilities" || operation === "tools") {
      return {
        options: { "--json": booleanOption },
        argumentOffset: 2,
        maxPositionals: 0,
      };
    }
    if (operation === "markdown") {
      return {
        options: {
          "--route": stringOption,
          "--json": booleanOption,
        },
        argumentOffset: 2,
        maxPositionals: 0,
      };
    }
    if (operation === "call") {
      return {
        options: {
          "--params": stringOption,
          "--allow-mutations": booleanOption,
          "--json": booleanOption,
        },
        argumentOffset: 2,
        maxPositionals: 1,
      };
    }
    return { options: {}, argumentOffset: 2, maxPositionals: 0 };
  }
  if (command === "demod") {
    return {
      options: demodOptions,
      argumentOffset: 1,
      maxPositionals: 1,
    };
  }
  return { options: {}, argumentOffset: 1, maxPositionals: 0 };
}

function validateOptionValue(
  name: string,
  rawValue: string,
  spec: OptionSpec,
): void {
  if (!rawValue) throw new CliUsageError(`Option ${name} requires a value`);
  if (spec.choices && !spec.choices.includes(rawValue)) {
    throw new CliUsageError(
      `Option ${name} must be one of: ${spec.choices.join(", ")}`,
    );
  }
  if (spec.kind !== "number") return;
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    throw new CliUsageError(`Option ${name} must be a finite number`);
  }
  if (spec.integer && !Number.isSafeInteger(value)) {
    throw new CliUsageError(`Option ${name} must be a safe integer`);
  }
  if (spec.positive && value <= 0) {
    throw new CliUsageError(`Option ${name} must be greater than zero`);
  }
}

export function validateCliArguments(args: readonly string[]): string[] {
  const spec = specFor(args);
  const normalizedOptions: string[] = [];
  const positionals: string[] = [];
  const seen = new Set<string>();
  let positionalCount = 0;
  let extraArgument: string | undefined;
  let optionsEnded = false;

  const addPositional = (token: string) => {
    positionals.push(token);
    positionalCount += 1;
    if (positionalCount > spec.maxPositionals && extraArgument === undefined) {
      extraArgument = token;
    }
  };

  for (let index = spec.argumentOffset; index < args.length; index += 1) {
    const token = args[index];
    if (optionsEnded) {
      addPositional(token);
      continue;
    }
    if (token === "--") {
      optionsEnded = true;
      continue;
    }
    if (!token.startsWith("-") || token === "-") {
      addPositional(token);
      continue;
    }

    const equalsIndex = token.indexOf("=");
    const name = equalsIndex >= 0 ? token.slice(0, equalsIndex) : token;
    const option = spec.options[name];
    if (!option) throw new CliUsageError(`Unknown option: ${name}`);
    if (seen.has(name)) throw new CliUsageError(`Duplicate option: ${name}`);
    seen.add(name);

    if (option.kind === "boolean") {
      if (equalsIndex >= 0) {
        throw new CliUsageError(`Option ${name} does not take a value`);
      }
      normalizedOptions.push(name);
      continue;
    }

    let value: string | undefined;
    if (equalsIndex >= 0) {
      value = token.slice(equalsIndex + 1);
    } else {
      const candidate = args[index + 1];
      if (candidate === undefined || candidate.startsWith("--")) {
        throw new CliUsageError(`Option ${name} requires a value`);
      }
      value = candidate;
      index += 1;
    }
    validateOptionValue(name, value, option);
    normalizedOptions.push(name, value);
  }

  if (extraArgument !== undefined) {
    throw new CliUsageError(`Unexpected argument: ${extraArgument}`);
  }
  return [
    ...args.slice(0, spec.argumentOffset),
    ...positionals,
    ...normalizedOptions,
  ];
}
