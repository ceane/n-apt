export interface TxSuiteSourceControlInput {
  isTxSuite: boolean;
  rxSourceId: string | null | undefined;
  selectedSourceId: string | null | undefined;
  activeSourceId: string | null | undefined;
}

/** Keep Tx Suite's legacy control stream on the assigned Rx source. */
export const resolveTxSuiteControlSourceId = ({
  isTxSuite,
  rxSourceId,
  selectedSourceId,
  activeSourceId,
}: TxSuiteSourceControlInput): string | null => {
  if (isTxSuite && rxSourceId) return rxSourceId;
  return selectedSourceId || activeSourceId || null;
};

export const shouldPinTxSuiteToRxSource = ({
  isTxSuite,
  rxSourceId,
  selectedSourceId,
}: Pick<
  TxSuiteSourceControlInput,
  "isTxSuite" | "rxSourceId" | "selectedSourceId"
>): boolean =>
  isTxSuite && Boolean(rxSourceId) && selectedSourceId !== rxSourceId;
