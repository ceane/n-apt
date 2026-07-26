import React from "react";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import styled from "styled-components";
import {
  selectActiveSourceDerivedState,
  selectActiveSource,
  selectWebSocketSources,
  selectSelectedFiles,
  selectSourceMode,
} from "@n-apt/redux/selectors/performanceSelectors";
import { useAppSelector } from "@n-apt/redux";
import { useAppDispatch } from "@n-apt/redux";
import {
  setSourceBinding,
  sourceBindingKey,
} from "@n-apt/redux/slices/sourceRoutingSlice";

const SourceContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
  min-width: 180px;
`;

const SourceHeader = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
`;

const IconContainer = styled.div`
  padding: 8px;
  background: ${({ theme }) => theme.colors.primary}1a;
  border-radius: 8px;
  border: 1px solid ${({ theme }) => theme.colors.primary}33;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const IconEmoji = styled.span`
  font-size: 20px;
`;

const TextContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const TitleText = styled.div`
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.primary};
  opacity: 0.9;
`;

const SubtitleText = styled.div`
  font-size: 13px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.typography.mono};
  letter-spacing: -0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
`;

const RoleAssignments = styled.div`
  display: grid;
  gap: 8px;
  min-width: 280px;
  margin-top: 8px;
`;

const RoleRow = styled.label`
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 11px;
  font-family: ${({ theme }) => theme.typography.mono};
`;

const RoleSelect = styled.select`
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
  font: inherit;
`;

interface SourceNodeProps {
  data: {
    sourceNode: boolean;
    label: string;
    txSuiteSource?: boolean;
    sourceBindingGroup?: string;
    sourceAssignmentGroup?: string;
  };
}

export const SourceNode: React.FC<SourceNodeProps> = ({ data }) => {
  const dispatch = useAppDispatch();
  const { wsConnection, deviceName: spectrumDeviceName } = useSpectrumStore();
  const activeSource = useAppSelector(selectActiveSource);
  const activeSourceDerived = useAppSelector(selectActiveSourceDerivedState);
  const sources = useAppSelector(selectWebSocketSources);
  const selectedFiles = useAppSelector(selectSelectedFiles);
  const sourceMode = useAppSelector(selectSourceMode);
  const bindingGroup =
    data.sourceBindingGroup ?? data.sourceAssignmentGroup ?? "default";
  const isAssignmentNode = Boolean(
    data.sourceBindingGroup || data.sourceAssignmentGroup || data.txSuiteSource,
  );
  const rxSourceId = useAppSelector(
    (state) =>
      state.sourceRouting.bindings[sourceBindingKey(bindingGroup, "rx")] ??
      null,
  );
  const txSourceId = useAppSelector(
    (state) =>
      state.sourceRouting.bindings[sourceBindingKey(bindingGroup, "tx")] ??
      null,
  );

  const primaryFileName =
    selectedFiles.length > 0 ? selectedFiles[0].name : "Select a file...";

  const options = [
    ...sources.map((source) => ({
      id: source.id,
      label: source.name || source.id,
      capability: source.capability,
    })),
    ...selectedFiles.map((file) => ({
      id: `file:${file.name}`,
      label: `File: ${file.name}`,
      capability: "rx",
    })),
  ];

  React.useEffect(() => {
    if (!isAssignmentNode || options.length === 0) return;
    const hasRx = options.some((option) => option.id === rxSourceId);
    const hasTx = options.some((option) => option.id === txSourceId);
    const rxCandidate =
      options.find(
        (option) => option.capability === "rx" || option.capability === "tx_rx",
      ) ?? options[0];
    const txCandidate =
      options.find(
        (option) =>
          option.id !== (hasRx ? rxSourceId : rxCandidate.id) &&
          (option.capability === "tx" || option.capability === "tx_rx"),
      ) ??
      options[1] ??
      options[0];
    if (!hasRx || !hasTx) {
      dispatch(
        setSourceBinding({
          group: bindingGroup,
          role: "rx",
          sourceId: hasRx ? rxSourceId : rxCandidate.id,
        }),
      );
      if (!hasTx) {
        dispatch(
          setSourceBinding({
            group: bindingGroup,
            role: "tx",
            sourceId: txCandidate.id,
          }),
        );
      }
    }
  }, [
    bindingGroup,
    dispatch,
    isAssignmentNode,
    options,
    rxSourceId,
    txSourceId,
  ]);

  const displayTitle = sourceMode === "file" ? "File" : "Source";
  const deviceName =
    activeSourceDerived.deviceName ||
    wsConnection?.deviceName ||
    spectrumDeviceName ||
    data?.label ||
    "SDR Device";
  const displaySubtitle = sourceMode === "file" ? primaryFileName : deviceName;

  if (isAssignmentNode) {
    return (
      <SourceContainer>
        <SourceHeader>
          <IconContainer>
            <IconEmoji>📡</IconEmoji>
          </IconContainer>
          <TextContainer>
            <TitleText>Sources</TitleText>
            <SubtitleText>Assign Rx and Tx roles</SubtitleText>
          </TextContainer>
        </SourceHeader>
        <RoleAssignments>
          <RoleRow>
            Rx source
            <RoleSelect
              aria-label="Rx source"
              value={rxSourceId ?? ""}
              onChange={(event) =>
                dispatch(
                  setSourceBinding({
                    group: bindingGroup,
                    role: "rx",
                    sourceId: event.target.value,
                  }),
                )
              }
            >
              {options.map((option) => (
                <option key={`rx-${option.id}`} value={option.id}>
                  {option.label}
                </option>
              ))}
            </RoleSelect>
          </RoleRow>
          <RoleRow>
            Tx source
            <RoleSelect
              aria-label="Tx source"
              value={txSourceId ?? ""}
              onChange={(event) =>
                dispatch(
                  setSourceBinding({
                    group: bindingGroup,
                    role: "tx",
                    sourceId: event.target.value,
                  }),
                )
              }
            >
              {options.map((option) => (
                <option key={`tx-${option.id}`} value={option.id}>
                  {option.label}
                </option>
              ))}
            </RoleSelect>
          </RoleRow>
        </RoleAssignments>
      </SourceContainer>
    );
  }

  return (
    <SourceContainer>
      <SourceHeader>
        <IconContainer>
          <IconEmoji>{sourceMode === "file" ? "📁" : "📡"}</IconEmoji>
        </IconContainer>
        <TextContainer>
          <TitleText>{displayTitle}</TitleText>
          <SubtitleText>{displaySubtitle}</SubtitleText>
        </TextContainer>
      </SourceHeader>
    </SourceContainer>
  );
};
