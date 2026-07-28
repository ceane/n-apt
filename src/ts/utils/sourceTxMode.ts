import {
  resolveSourceModeManagement,
  type SourceModeSource,
} from "@n-apt/utils/sourceModeManagement";

export interface SourceTxModeInput {
  source?: SourceModeSource | null;
  txBindingSourceId?: string | null;
  txPreviewSourceId?: string | null;
}

/** @deprecated Use sourceModeManagement for all source/mode decisions. */
export const isSourceInTxMode = ({
  source,
  txBindingSourceId,
  txPreviewSourceId,
}: SourceTxModeInput): boolean =>
  resolveSourceModeManagement({
    source,
    txBindingSourceId,
    txPreviewSourceId,
  }).isTxMode;
