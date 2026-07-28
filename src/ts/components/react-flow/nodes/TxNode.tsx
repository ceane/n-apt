import React from "react";
import styled from "styled-components";
import { SatelliteDish } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import {
  setTxSignal, setTxSampleRateHz, setTxIfftSize, setTxCenterFrequencyHz,
  setTxPowerDbm, setTxVgaGain, setTxSafetyEnabled, setTxSafetyLimit,
  setTxHopType, setTxHopStartFrequencyHz, setTxHopEndFrequencyHz,
  setTxHopChannels, setTxHopRateHz, setTxHopEnabled, setHackrfAmpEnabled,
  setFrequencyRange,
} from "@n-apt/redux";
import {
  getTxFrequencyRangeForBandwidth,
  TxSettingsSection,
} from "@n-apt/components/sidebar/TxSettingsSection";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { sourceBindingKey } from "@n-apt/redux/slices/sourceRoutingSlice";

const NodeContent = styled.div`
  width: 100%;
  min-width: 360px;

  /* React Flow nodes use the same flat row treatment as SignalConfigNode. */
  & > div {
    grid-template-columns: 1fr 1fr;
  }

  & > div > div {
    margin-top: 0;
  }

  & > div > div:not(:first-child) {
    background: transparent;
    border: none;
    border-radius: 0;
  }
`;

const NodeHeader = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-bottom: ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-weight: 700;
`;

export const TxNode: React.FC<{ data: { label: string } }> = ({ data }) => {
  const dispatch = useAppDispatch();
  const tx = useAppSelector((state) => state.spectrum);
  const { selectedSource, selectedSourceId, wsConnection } = useSpectrumStore();
  const txSourceId = useAppSelector(
    (state) =>
      state.sourceRouting?.bindings[sourceBindingKey("tx-suite", "tx")] ??
      null,
  );
  const txSource = useAppSelector((state) =>
    (state.websocket.sources ?? []).find((source) => source.id === txSourceId),
  );
  const transmitSource = txSource ?? selectedSource;
  const transmitSourceId = txSource?.id ?? selectedSourceId;
  const isTransmitting = transmitSource?.status === "transmitting";
  const toggleTransmit = React.useCallback(() => {
    const device = transmitSource?.name ?? transmitSourceId;
    if (!device) return;
    wsConnection.sendTransmitMode?.(!isTransmitting, device, {
      serialNumber: transmitSource?.serial_number ?? transmitSourceId,
      centerFrequencyHz: tx.txCenterFrequencyHz,
      bandwidthHz: tx.txSampleRateHz,
      ifftSize: tx.txIfftSize,
      powerDbm: tx.txPowerDbm,
      vgaGainDb: tx.txVgaGain,
      ampEnabled: tx.hackrfAmpEnabled,
      txSafetyEnabled: tx.txSafetyEnabled,
      txSafetyLimit: tx.txSafetyLimit,
      txSignal: tx.txSignal,
      txHopEnabled: tx.txHopEnabled,
      txHopType: tx.txHopType,
      txHopStartFrequencyHz: tx.txHopStartFrequencyHz,
      txHopEndFrequencyHz: tx.txHopEndFrequencyHz,
      txHopChannels: tx.txHopChannels,
      txHopRateHz: tx.txHopRateHz,
    });
  }, [isTransmitting, transmitSource, transmitSourceId, tx, wsConnection]);
  const signalOptions = [
    { value: "wifi", label: "Mock WiFi" },
    { value: "5g", label: "Mock 5G" },
    { value: "d", label: "D" },
    { value: "d_sharp", label: "D#" },
  ];

  return (
    <NodeContent>
      <NodeHeader><SatelliteDish size={16} />{data.label}</NodeHeader>
      <TxSettingsSection
        signal={tx.txSignal}
        bandwidthHz={tx.txSampleRateHz}
        fftSize={tx.fftSize}
        ifftSize={tx.txIfftSize}
        ifftSizeOptions={tx.fftSizeOptions}
        centerFrequencyHz={tx.txCenterFrequencyHz}
        powerDbm={tx.txPowerDbm}
        vgaGainDb={tx.txVgaGain}
        ampEnabled={tx.hackrfAmpEnabled}
        signalOptions={signalOptions}
        onSignalChange={(value) => dispatch(setTxSignal(value))}
        onBandwidthChange={(value) => {
          dispatch(setTxSampleRateHz(value));
          if (Number.isFinite(tx.txCenterFrequencyHz) && value > 0) {
            const min = Math.max(0, tx.txCenterFrequencyHz - value / 2);
            const max = tx.txCenterFrequencyHz + value / 2;
            dispatch(setFrequencyRange({ min, max }));
          }
        }}
        onIfftSizeChange={(value) => dispatch(setTxIfftSize(value))}
        onCenterFrequencyChange={(value) => {
          dispatch(setTxCenterFrequencyHz(value));
          const bw =
            typeof tx.txSampleRateHz === "number" && tx.txSampleRateHz > 0
              ? tx.txSampleRateHz
              : 2_400_000;
          dispatch(
            setFrequencyRange(
              getTxFrequencyRangeForBandwidth(value, bw) ?? {
                min: 0,
                max: bw,
              },
            ),
          );
        }}
        onPowerDbmChange={(value) => dispatch(setTxPowerDbm(value))}
        onVgaGainChange={(value) => dispatch(setTxVgaGain(value))}
        onAmpEnabledChange={(value) => dispatch(setHackrfAmpEnabled(value))}
        isTransmitting={isTransmitting}
        onToggleTransmit={toggleTransmit}
        safetyEnabled={tx.txSafetyEnabled}
        onSafetyEnabledChange={(value) => dispatch(setTxSafetyEnabled(value))}
        safetyLimit={tx.txSafetyLimit}
        onSafetyLimitChange={(value) => dispatch(setTxSafetyLimit(value))}
        hopEnabled={tx.txHopEnabled}
        onHopEnabledChange={(value) => dispatch(setTxHopEnabled(value))}
        hopType={tx.txHopType}
        onHopTypeChange={(value) => dispatch(setTxHopType(value))}
        hopStartFrequencyHz={tx.txHopStartFrequencyHz}
        onHopStartFrequencyHzChange={(value) => dispatch(setTxHopStartFrequencyHz(value))}
        hopEndFrequencyHz={tx.txHopEndFrequencyHz}
        onHopEndFrequencyHzChange={(value) => dispatch(setTxHopEndFrequencyHz(value))}
        hopChannels={tx.txHopChannels}
        onHopChannelsChange={(value) => dispatch(setTxHopChannels(value))}
        hopRateHz={tx.txHopRateHz}
        onHopRateHzChange={(value) => dispatch(setTxHopRateHz(value))}
      />
    </NodeContent>
  );
};
