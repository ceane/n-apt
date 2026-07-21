import React, { useMemo } from "react";
import styled from "styled-components";
import { Columns3Cog } from "lucide-react";
import { SignalDisplaySection } from "@n-apt/components/sidebar/SignalDisplaySection";
import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import {
  setTxViewerFftFrameRate,
  setTxViewerFftSize,
  setTxViewerFftWindow,
  setTxViewerPowerScale,
  setTxViewerSampleRateHz,
  setTxViewerTemporalResolution,
} from "@n-apt/redux";
import { sourceBindingKey } from "@n-apt/redux/slices/sourceRoutingSlice";
import { resolveWholeChannelSampleRate } from "@n-apt/utils/sourceSignalDisplay";

const NodeContent = styled.div`
  width: 100%;
  min-width: 360px;

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
  font-size: ${({ theme }) => theme.typography.bodySize};
  font-weight: 700;
`;

const NodeSubtitle = styled.div`
  margin-bottom: ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 10px;
`;

const FALLBACK_SAMPLE_RATES = [
  3_200_000,
];

const FALLBACK_FFT_SIZES = [2048, 4096, 8192, 16384, 32768, 65536];

interface TxSignalConfigNodeProps {
  data: { txSignalOptions: boolean; label: string };
}

const TxSignalConfigNodeComponent: React.FC<TxSignalConfigNodeProps> = ({
  data,
}) => {
  const dispatch = useAppDispatch();
  const txSignal = useAppSelector((state) => state.spectrum.txSignal);
  const activeSignalArea = useAppSelector(
    (state) => state.spectrum.activeSignalArea,
  );
  const fftSizeOptions = useAppSelector(
    (state) => state.spectrum.fftSizeOptions,
  );
  const txViewerSampleRateHz = useAppSelector(
    (state) => state.spectrum.txViewerSampleRateHz,
  );
  const txViewerFftFrameRate = useAppSelector(
    (state) => state.spectrum.txViewerFftFrameRate,
  );
  const txViewerFftSize = useAppSelector(
    (state) => state.spectrum.txViewerFftSize,
  );
  const txViewerFftWindow = useAppSelector(
    (state) => state.spectrum.txViewerFftWindow,
  );
  const txViewerTemporalResolution = useAppSelector(
    (state) => state.spectrum.txViewerTemporalResolution,
  );
  const txViewerPowerScale = useAppSelector(
    (state) => state.spectrum.txViewerPowerScale,
  );
  const websocketBackend = useAppSelector((state) => state.websocket.backend);
  const txSourceId = useAppSelector(
    (state) => state.sourceRouting.bindings[sourceBindingKey("tx-suite", "tx")],
  );
  const txSource = useAppSelector((state) =>
    (state.websocket.sources ?? []).find((source) => source.id === txSourceId),
  );
  const channels = useAppSelector((state) => state.websocket.channels ?? []);
  const wholeChannelSampleRate = resolveWholeChannelSampleRate({
    source: txSource,
    txSignal,
    activeSignalArea,
    channels,
  });

  const sampleRateOptions = useMemo(() => {
    const configured = txSource?.sdr.sample_rate_options ?? [];
    return Array.from(
      new Set(
        (configured.length > 0 ? configured : FALLBACK_SAMPLE_RATES).filter(
          (rate) => Number.isFinite(rate) && rate > 0,
        ),
      ),
    ).sort((a, b) => a - b);
  }, [txSource?.sdr.sample_rate_options]);

  const resolvedFftSizeOptions = useMemo(() => {
    const configured = fftSizeOptions ?? [];
    return Array.from(
      new Set(
        (configured.length > 0 ? configured : FALLBACK_FFT_SIZES).filter(
          (size) => Number.isFinite(size) && size > 0,
        ),
      ),
    ).sort((a, b) => a - b);
  }, [fftSizeOptions]);

  const maxSampleRate =
    txSource?.sdr.max_sample_rate ??
    Math.max(...sampleRateOptions, txViewerSampleRateHz);
  const maxFrameRate = txSource?.sdr.settings?.fft?.max_frame_rate ?? 60;

  // Prime a separately routed Tx source once when the node mounts. Subsequent
  // Tx setting changes are refreshed by websocket middleware after the Redux
  // action lands, avoiding duplicate request_next_frame messages.
  React.useEffect(() => {
    dispatch({ type: "txSuite/requestPreview" });
    dispatch(setTxViewerTemporalResolution("high"));
  }, [dispatch]);

  return (
    <NodeContent>
      <NodeHeader>
        <Columns3Cog size={16} />
        {data.label}
      </NodeHeader>
      <NodeSubtitle>Tx viewer sampling and FFT settings</NodeSubtitle>

      <SignalDisplaySection
        variant="default"
        sourceMode="live"
        maxSampleRate={maxSampleRate}
        sampleRate={txViewerSampleRateHz}
        sampleRateLabel="FFT view sample rate"
        sampleRateOptions={sampleRateOptions}
        wholeChannelSampleRate={wholeChannelSampleRate}
        fileCapturedRange={null}
        fftFrameRate={txViewerFftFrameRate}
        maxFrameRate={maxFrameRate}
        fftSize={txViewerFftSize}
        fftSizeOptions={resolvedFftSizeOptions}
        fftWindow={txViewerFftWindow}
        temporalResolution={txViewerTemporalResolution}
        backend={txSource?.kind ?? websocketBackend}
        deviceProfile={null}
        powerScale={txViewerPowerScale}
        onFftFrameRateChange={(value) =>
          dispatch(setTxViewerFftFrameRate(value))
        }
        onFftSizeChange={(value) => dispatch(setTxViewerFftSize(value))}
        onSampleRateChange={(value) =>
          dispatch(setTxViewerSampleRateHz(value))
        }
        onFftWindowChange={(value) => dispatch(setTxViewerFftWindow(value))}
        onTemporalResolutionChange={(value) =>
          dispatch(setTxViewerTemporalResolution(value))
        }
        onPowerScaleChange={(value) => dispatch(setTxViewerPowerScale(value))}
        scheduleCoupledAdjustment={() => undefined}
      />
    </NodeContent>
  );
};

export const TxSignalConfigNode = React.memo(TxSignalConfigNodeComponent);
