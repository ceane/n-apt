import React from "react";
import styled from "styled-components";
import { Activity } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@n-apt/redux";
import { setTxSignal } from "@n-apt/redux";
import { sourceBindingKey } from "@n-apt/redux/slices/sourceRoutingSlice";

const Card = styled.section`
  display: grid;
  gap: 10px;
  width: 300px;
  padding: 14px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 11px;
`;

const Header = styled.header`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
`;

const PatternSelect = styled.select`
  width: 100%;
  min-height: 34px;
  padding: 6px 8px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 7px;
  background: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.textPrimary};
  font: inherit;
`;

const Copy = styled.p`
  margin: 0;
  color: ${({ theme }) => theme.colors.textSecondary};
  line-height: 1.5;
`;

const Status = styled.div`
  padding: 8px 10px;
  border-left: 2px solid ${({ theme }) => theme.colors.primary};
  background: rgba(0, 212, 255, 0.06);
  line-height: 1.45;
`;

const TX_PATTERNS = [
  ["wifi", "Naive WiFi"],
  ["5g", "Naive 5G"],
  ["d", "D"],
  ["d_sharp", "D#"],
  ["tone", "Tone"],
  ["noise", "Noise"],
  ["custom", "Custom"],
] as const;

interface ExperimentControlNodeProps {
  data: {
    label?: string;
    sourceBindingGroup?: string;
  };
}

export const ExperimentControlNode: React.FC<ExperimentControlNodeProps> = ({
  data,
}) => {
  const dispatch = useAppDispatch();
  const pattern = useAppSelector((state) => state.spectrum.txSignal);
  const txPowerDbm = useAppSelector((state) => state.spectrum.txPowerDbm);
  const safetyEnabled = useAppSelector((state) => state.spectrum.txSafetyEnabled);
  const bindingGroup = data.sourceBindingGroup ?? "reverse-engineering";
  const txSourceId = useAppSelector(
    (state) =>
      state.sourceRouting.bindings[sourceBindingKey(bindingGroup, "tx")] ??
      null,
  );
  const txSource = useAppSelector((state) => {
    return (state.websocket.sources ?? []).find(
      (source) => source.id === txSourceId,
    );
  });
  const txStatus = useAppSelector((state) =>
    txSourceId
      ? (state.websocket.sourceStatuses[txSourceId] ?? txSource?.status ?? null)
      : null,
  );

  return (
    <Card aria-label={data.label ?? "Experiment control"}>
      <Header>
        <Activity size={16} />
        {data.label ?? "Tx experiment condition"}
      </Header>
      <label>
        Transmit pattern
        <PatternSelect
          aria-label="Transmit pattern"
          value={pattern}
          onChange={(event) => dispatch(setTxSignal(event.currentTarget.value))}
        >
          {TX_PATTERNS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </PatternSelect>
      </label>
      <Status role={txSource ? "status" : "alert"}>
        {txSource
          ? `${txSource.name || txSource.id}: ${txStatus ?? "standby"}. Use Tx Settings to start or stop this pattern.`
          : "No Tx device is assigned. Select the HackRF One in the Sources node before transmitting."}
      </Status>
      <Copy>
        OTA controlled-area experiment · current output {txPowerDbm} dBm · Tx
        safety limit {safetyEnabled ? "enabled" : "disabled"}.
        {!safetyEnabled && " Enable the Tx safety limit in Tx Settings before starting."}
      </Copy>
      <Copy>
        Compare one pattern at a time. Record the channel, pattern, transmit
        settings, and the receive features you observe for each condition.
      </Copy>
    </Card>
  );
};
