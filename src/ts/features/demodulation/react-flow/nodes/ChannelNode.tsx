import React from "react";
import { Zap } from "lucide-react";
import styled from "styled-components";
import { Channels } from "@n-apt/spectrum";
import { useAppSelector } from "@n-apt/redux";
import { formatFrequency } from "@n-apt/math/frequency";
import { sourceBindingKey } from "@n-apt/redux/slices/sourceRoutingSlice";

const ReceiverReadout = styled.div`
  margin-bottom: 9px;
  padding: 8px 10px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font: 10px/1.45 monospace;
`;

interface ChannelNodeProps {
  data: {
    channelNode: boolean;
    label: string;
    channelLabels?: readonly string[];
    sourceBindingGroup?: string;
    receiveSampleRateLimitHz?: number;
  };
}

export const ChannelNode: React.FC<ChannelNodeProps> = ({ data }) => {
  const sourceId = useAppSelector((state) =>
    data.sourceBindingGroup
      ? state.sourceRouting.bindings[
          sourceBindingKey(data.sourceBindingGroup, "rx")
        ] ?? null
      : state.websocket.activeSourceId,
  );
  const source = useAppSelector((state) =>
    (state.websocket.sources ?? []).find((candidate) => candidate.id === sourceId),
  );
  const status = useAppSelector((state) =>
    sourceId
      ? (state.websocket.sourceStatuses[sourceId] ?? source?.status ?? null)
      : null,
  );
  const rawSampleRate = useAppSelector(
    (state) => source?.sdr.settings.sample_rate ?? state.websocket.sampleRateHz ?? state.spectrum.sampleRateHz,
  );
  const sampleRateLimitHz = data.receiveSampleRateLimitHz ?? 3_200_000;
  const displayedSampleRate = Math.min(
    Number.isFinite(rawSampleRate) && Number(rawSampleRate) > 0
      ? Number(rawSampleRate)
      : sampleRateLimitHz,
    sampleRateLimitHz,
  );
  const range = useAppSelector((state) => state.spectrum.frequencyRange);
  const centerFrequencyHz = range && Number.isFinite(range.min) && Number.isFinite(range.max)
    ? (range.min + range.max) / 2
    : null;
  const isReady = Boolean(source) && status !== "disconnected" && status !== "stale" && status !== "error";

  return (
    <div style={{ minWidth: "260px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: "10px",
        }}
      >
        <div
          style={{
            padding: "6px",
            background: "#a855f722",
            borderRadius: "6px",
          }}
        >
          <Zap size={14} color="#a855f7" />
        </div>
        <div>
          <div
            style={{
              fontSize: "12px",
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Channel
          </div>
          <div
            style={{ fontSize: "9px", opacity: 0.45, fontFamily: "monospace" }}
          >
            Signal Area
          </div>
        </div>
      </div>
      {/* Provide a grid context so Channels' subgrid works outside of the sidebar */}
      {/* Use 'nodrag nopan' class so sliders are interactive within React Flow */}
      <div
        className="nodrag nopan"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: "8px",
          width: "100%",
        }}
      >
        {data.sourceBindingGroup && (
          <ReceiverReadout role={isReady ? "status" : "alert"}>
            <div>Rx · {source?.name ?? "RTL-SDR not assigned"} · {status ?? "waiting"}</div>
            <div>
              Center {centerFrequencyHz === null ? "unavailable" : formatFrequency(centerFrequencyHz)}
              {" · "}visible span capped at {formatFrequency(sampleRateLimitHz)}
            </div>
            <div>Current sample rate {formatFrequency(displayedSampleRate)} / 3.2 MS/s</div>
          </ReceiverReadout>
        )}
        <Channels
          variant={data.sourceBindingGroup ? "demod" : "spectrum"}
          hideTitle={true}
          channelLabels={data.channelLabels}
          activeSampleRateHz={data.sourceBindingGroup ? displayedSampleRate : undefined}
          rangeSlidersDisabled={Boolean(data.sourceBindingGroup) && !isReady}
        />
      </div>
    </div>
  );
};
