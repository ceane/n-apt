export type FailingServices = 'Vite' | 'Rust' | 'Redis' | 'WebAssembly';

interface RuntimeSummaryStateArgs {
  hasErrors: boolean;
  hasCompilationErrors: boolean;
  vitePid?: number;
  rustPid?: number;
  redisPid?: number;
  failingServices?: FailingServices[];
}

interface RuntimeSummaryState {
  label: string;
  color: 'green' | 'yellow' | 'red';
}

const hasValidPid = (pid?: number): boolean =>
  typeof pid === 'number' && Number.isInteger(pid) && pid > 0;

const recoverySignalPatterns = [
  /\bhmr update\b/i,
  /\bpage reload\b/i,
  /\bbuilt in\b/i,
  /\bready in\b/i,
  /\bcompiled successfully\b/i,
  /\bvite\b.*\bready\b/i,
  /\blocal:\s+http/i,
];

export const isRuntimeRecoverySignal = (output: string): boolean => {
  const trimmed = output.trim();
  if (!trimmed) {
    return false;
  }

  if (recoverySignalPatterns.some((pattern) => pattern.test(trimmed))) {
    return true;
  }

  return false;
};

export const getRuntimeSummaryState = ({
  hasErrors,
  hasCompilationErrors,
  vitePid,
  rustPid,
  redisPid,
  failingServices = []
}: RuntimeSummaryStateArgs): RuntimeSummaryState => {
  const hasAnyErrors = hasErrors || hasCompilationErrors;
  const isRunning =
    hasValidPid(vitePid) && hasValidPid(rustPid) && hasValidPid(redisPid);

  if (hasAnyErrors && isRunning) {
    const serviceList = failingServices.length > 0
      ? ` - ${failingServices.join(', ')}`
      : '';
    return {
      label: `▲ HAS ERRORS BUT RUNNING${serviceList}`,
      color: 'yellow'
    };
  }

  if (hasAnyErrors || !isRunning) {
    const serviceList = failingServices.length > 0
      ? ` - ${failingServices.join(', ')}`
      : '';
    return {
      label: `✗ Stopped${serviceList}`,
      color: 'red'
    };
  }

  return {
    label: '✓ Running',
    color: 'green'
  };
};
