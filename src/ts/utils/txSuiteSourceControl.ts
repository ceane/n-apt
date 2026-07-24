export interface TxSuiteSourceControlInput {
  isTxSuite: boolean;
  isTxSuiteRouteActive: boolean;
  rxSourceId: string | null | undefined;
  selectedSourceId: string | null | undefined;
  activeSourceId: string | null | undefined;
}

/** Keep Tx Suite's legacy control stream on the assigned Rx source. */
export const resolveTxSuiteControlSourceId = ({
  isTxSuite,
  isTxSuiteRouteActive,
  rxSourceId,
  selectedSourceId,
  activeSourceId,
}: TxSuiteSourceControlInput): string | null => {
  if (isTxSuite && isTxSuiteRouteActive && rxSourceId) return rxSourceId;
  return selectedSourceId || activeSourceId || null;
};

export const shouldPinTxSuiteToRxSource = ({
  isTxSuite,
  isTxSuiteRouteActive,
  rxSourceId,
  selectedSourceId,
}: Pick<
  TxSuiteSourceControlInput,
  "isTxSuite" | "isTxSuiteRouteActive" | "rxSourceId" | "selectedSourceId"
>): boolean =>
  isTxSuite &&
  isTxSuiteRouteActive &&
  Boolean(rxSourceId) &&
  selectedSourceId !== rxSourceId;
