import { CLI_CAPTURE_DESTINATION_IDS } from "@n-apt/capture/destinations";
import {
  validateCliFftColorArg,
  validateCliFrequencyRangeArg,
  validateCliGeolocationArg,
} from "@n-apt/cli/snapshotPolicy";

type OptionKind = "boolean" | "string" | "number";

type OptionSpec = {
  kind: OptionKind;
  choices?: readonly string[];
  integer?: boolean;
  positive?: boolean;
  minimum?: number;
  /** Returns an error message for an invalid value, or null when valid. */
  validate?: (value: string) => string | null;
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
  "--frequency": positiveNumber,
  "--center-frequency": positiveNumber,
  "--sample-rate": { kind: "number", positive: true, minimum: 3_200_000 },
  "--waterfall": booleanOption,
  "--dark": booleanOption,
  "--grid": booleanOption,
  "--no-grid": booleanOption,
  "--stats": booleanOption,
  "--no-stats": booleanOption,
  "--theme": { kind: "string", choices: ["dark", "light"] },
  "--use-theme-colors": booleanOption,
  "--fft-color": { kind: "string", validate: validateCliFftColorArg },
  "--frequency-range": {
    kind: "string",
    validate: validateCliFrequencyRangeArg,
  },
  "--power-scale": { kind: "string", choices: ["dB", "dBm"] },
  "--power-min": finiteNumber,
  "--power-max": finiteNumber,
  "--format": {
    kind: "string",
    choices: ["png", "svg", "animated-svg", "webm", "mp4"],
  },
  "--aspect-ratio": {
    kind: "string",
    choices: ["default", "4:3", "16:10", "16:9", "19.5:9"],
  },
  "--geolocation": {
    kind: "string",
    validate: validateCliGeolocationArg,
  },
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
  if (spec.validate) {
    const validationError = spec.validate(rawValue);
    if (validationError) throw new CliUsageError(validationError);
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
  if (spec.minimum !== undefined && value < spec.minimum) {
    throw new CliUsageError(`${name} must be at least ${spec.minimum} Hz`);
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

  if (
    spec.options === snapshotOptions &&
    normalizedOptions.includes("--geolocation") &&
    normalizedOptions.includes("--no-stats")
  ) {
    throw new CliUsageError(
      "Option --geolocation requires stats; remove --no-stats",
    );
  }
  if (
    spec.options === snapshotOptions &&
    normalizedOptions.includes("--stats") &&
    normalizedOptions.includes("--no-stats")
  ) {
    throw new CliUsageError("Options --stats and --no-stats cannot be combined");
  }
  if (
    spec.options === snapshotOptions &&
    normalizedOptions.includes("--grid") &&
    normalizedOptions.includes("--no-grid")
  ) {
    throw new CliUsageError("Options --grid and --no-grid cannot be combined");
  }
  if (spec.options === snapshotOptions) {
    const minIndex = normalizedOptions.indexOf("--power-min");
    const maxIndex = normalizedOptions.indexOf("--power-max");
    const scaleIndex = normalizedOptions.indexOf("--power-scale");
    const powerScale = scaleIndex < 0 ? "dB" : normalizedOptions[scaleIndex + 1];
    const defaultMin = powerScale === "dBm" ? -100 : -120;
    const defaultMax = powerScale === "dBm" ? 30 : 0;
    const min = minIndex < 0 ? defaultMin : Number(normalizedOptions[minIndex + 1]);
    const max = maxIndex < 0 ? defaultMax : Number(normalizedOptions[maxIndex + 1]);
    if (min >= max) {
      throw new CliUsageError("Option --power-min must be less than --power-max");
    }
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
