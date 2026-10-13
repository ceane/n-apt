import React from "react";
import { RetryableMlFeature } from "@n-apt/shared/ui/RetryableMlFeature";
import { loadEncryptedMlModule } from "@n-apt/shared/ui/loadEncryptedMlModule";
type NativeClassifierPanelProps = any;

const loadNativeClassifierPanel = () =>
  loadEncryptedMlModule().then((module) => ({
    default: module.nativeClassifier
      .NativeClassifierPanel as React.ComponentType<NativeClassifierPanelProps>,
  }));

export const NativeClassifierPanel: React.FC<NativeClassifierPanelProps> = (
  props,
) => (
  <RetryableMlFeature
    label="Native classifier"
    loader={loadNativeClassifierPanel}
    componentProps={props}
  />
);
