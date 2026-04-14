interface RuntimeSummaryStateArgs {
  hasErrors: boolean;
  hasCompilationErrors: boolean;
  vitePid?: number;
  rustPid?: number;
  redisPid?: number;
}

interface RuntimeSummaryState {
  label: '✓ Running' | '▲ HAS ERRORS BUT RUNNING' | '✗ Stopped';
  color: 'green' | 'yellow' | 'red';
}

const hasValidPid = (pid?: number): boolean =>
  typeof pid === 'number' && Number.isInteger(pid) && pid > 0;

const recoverySignalPatterns = [
  /\bhmr update\b/i,
  /\bpage reload\b/i,
  /\bbuilt in\b/i,
  /\bready in\b/i,
  /\bcompiled successfully\b/i
];

export const isRuntimeRecoverySignal = (output: string): boolean => {
  const trimmed = output.trim();
  if (!trimmed) {
    return false;
  }

  if (/\berror\b/i.test(trimmed)) {
    return false;
  }

  return recoverySignalPatterns.some((pattern) => pattern.test(trimmed));
};

export const getRuntimeSummaryState = ({
  hasErrors,
  hasCompilationErrors,
  vitePid,
  rustPid,
  redisPid
}: RuntimeSummaryStateArgs): RuntimeSummaryState => {
  const hasAnyErrors = hasErrors || hasCompilationErrors;
  const isRunning =
    hasValidPid(vitePid) && hasValidPid(rustPid) && hasValidPid(redisPid);

  if (hasAnyErrors && isRunning) {
    return {
      label: '▲ HAS ERRORS BUT RUNNING',
      color: 'yellow'
    };
  }

  if (hasAnyErrors || !isRunning) {
    return {
      label: '✗ Stopped',
      color: 'red'
    };
  }

  return {
    label: '✓ Running',
    color: 'green'
  };
};
