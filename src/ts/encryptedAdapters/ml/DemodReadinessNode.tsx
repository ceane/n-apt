import React from "react";
import { RetryableMlFeature } from "@n-apt/shared/ui/RetryableMlFeature";
import { loadEncryptedMlModule } from "@n-apt/shared/ui/loadEncryptedMlModule";

interface DemodReadinessNodeProps {
  data: { label?: string };
}

const loadDemodReadinessNode = () =>
  loadEncryptedMlModule().then((module) => {
    const component = module.DemodReadinessNode;
    if (typeof component !== "function") {
      throw new Error("The encrypted demod readiness node is unavailable.");
    }
    return {
      default: component as React.ComponentType<DemodReadinessNodeProps>,
    };
  });

export const DemodReadinessNode: React.FC<DemodReadinessNodeProps> = (
  props,
) => (
  <RetryableMlFeature
    label="Demod readiness"
    loader={loadDemodReadinessNode}
    componentProps={props}
  />
);
