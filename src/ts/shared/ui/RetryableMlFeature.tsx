import React, { Suspense, useCallback, useMemo, useRef, useState } from "react";
import {
  DecryptionFallback,
  type ModuleFailureKind,
} from "@n-apt/ui/DecryptionFallback";

export type MlFeatureLoader<Props extends object> = () => Promise<{
  default: React.ComponentType<Props>;
}>;

interface BoundaryProps {
  label: string;
  fallbackMessage?: string;
  onRetry: () => void;
  children: React.ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

class MlFeatureErrorBoundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  render() {
    if (this.state.error) {
      const detailMessage = this.state.error.message;
      const failureKind: ModuleFailureKind =
        /decrypt|authentication failed|integrity validation|password.*(?:required|incorrect)|UNSAFE_LOCAL_DEMOD_PASSWORD/i.test(
          detailMessage,
        )
          ? "decryption"
          : "load";
      return (
        <DecryptionFallback
          moduleName={this.props.label}
          errorType="ml"
          failureKind={failureKind}
          messageOverride={
            failureKind === "decryption"
              ? this.props.fallbackMessage
              : undefined
          }
          detailMessage={detailMessage}
          onRetry={this.props.onRetry}
          retryLabel={`Retry ${this.props.label}`}
        />
      );
    }
    return this.props.children;
  }
}

export function RetryableMlFeature<Props extends object>({
  label,
  fallbackMessage,
  loader,
  componentProps,
}: {
  label: string;
  fallbackMessage?: string;
  loader: MlFeatureLoader<Props>;
  componentProps: Props;
}) {
  const [attempt, setAttempt] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const LazyFeature = useMemo(
    () =>
      React.lazy(async () => {
        const loaded = await loaderRef.current();
        const component = loaded?.default as unknown;
        const isValidComponent =
          typeof component === "function" ||
          (typeof component === "object" &&
            component !== null &&
            "$$typeof" in component);
        if (!isValidComponent) {
          throw new Error(
            `${label} loaded without a valid React component export.`,
          );
        }
        return loaded;
      }),
    [attempt, label],
  );
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  return (
    <MlFeatureErrorBoundary
      key={attempt}
      label={label}
      fallbackMessage={fallbackMessage}
      onRetry={retry}
    >
      <Suspense fallback={<div role="status">Loading {label}…</div>}>
        <LazyFeature {...componentProps} />
      </Suspense>
    </MlFeatureErrorBoundary>
  );
}
