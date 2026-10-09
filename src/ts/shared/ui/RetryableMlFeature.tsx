import React, { Suspense, useCallback, useMemo, useRef, useState } from "react";
import { DecryptionFallback } from "@n-apt/ui/DecryptionFallback";

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
  failed: boolean;
}

class MlFeatureErrorBoundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <DecryptionFallback
          moduleName={this.props.label}
          errorType="ml"
          messageOverride={this.props.fallbackMessage}
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
    () => React.lazy(() => loaderRef.current()),
    [attempt],
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
