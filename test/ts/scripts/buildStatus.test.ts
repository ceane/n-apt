import { describe, expect, it } from '@jest/globals';
import {
  getRuntimeSummaryState,
  isRuntimeRecoverySignal
} from '../../../scripts/build/buildStatus';

describe('getRuntimeSummaryState', () => {
  it('returns running when all services are alive and there are no errors', () => {
    const state = getRuntimeSummaryState({
      hasErrors: false,
      hasCompilationErrors: false,
      vitePid: 111,
      rustPid: 222,
      redisPid: 333
    });

    expect(state).toEqual({
      label: '✓ Running',
      color: 'green'
    });
  });

  it('returns has-errors-but-running when errors exist but all services are alive', () => {
    const state = getRuntimeSummaryState({
      hasErrors: true,
      hasCompilationErrors: true,
      vitePid: 111,
      rustPid: 222,
      redisPid: 333
    });

    expect(state).toEqual({
      label: '▲ HAS ERRORS BUT RUNNING',
      color: 'yellow'
    });
  });

  it('returns stopped when errors exist and one or more services are missing', () => {
    const state = getRuntimeSummaryState({
      hasErrors: true,
      hasCompilationErrors: true,
      vitePid: undefined,
      rustPid: 222,
      redisPid: 333
    });

    expect(state).toEqual({
      label: '✗ Stopped',
      color: 'red'
    });
  });
});

describe('isRuntimeRecoverySignal', () => {
  it('detects Vite hmr updates as recovery output', () => {
    expect(
      isRuntimeRecoverySignal('[vite] hmr update /src/ts/App.tsx')
    ).toBe(true);
  });

  it('detects Vite build completion output as recovery output', () => {
    expect(isRuntimeRecoverySignal('✓ built in 218ms')).toBe(true);
    expect(isRuntimeRecoverySignal('ready in 412ms')).toBe(true);
  });

  it('does not treat error lines as recovery output', () => {
    expect(
      isRuntimeRecoverySignal(
        '[vite] Internal server error: Failed to resolve import'
      )
    ).toBe(false);
    expect(isRuntimeRecoverySignal('')).toBe(false);
  });
});
