import React from "react";
import { RetryableMlFeature } from "@n-apt/shared/ui/RetryableMlFeature";
import { loadEncryptedMlModule } from "@n-apt/shared/ui/loadEncryptedMlModule";
import type { NativeClassifierPanel as ProtectedNativeClassifierPanel } from "@n-apt/classification/native/NativeClassifierPanel";

type NativeClassifierPanelProps = Parameters<
  typeof ProtectedNativeClassifierPanel
>[0];

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
