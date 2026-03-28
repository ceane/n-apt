import React from 'react';
import styled from 'styled-components';

interface MapEndpointsHUDProps {
  truncated: boolean;
  totalFound: number | null;
  currentCount: number;
  towersLoading: boolean;
  towersError: string | null;
}

const HUDContainer = styled.div`
  min-width: 220px;
  max-width: 260px;
  width: fit-content;
  pointer-events: none;
  user-select: none;
`;

const TowerCountRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  color: ${(props) => props.theme.textPrimary};
  white-space: nowrap;
`;

const Notification = styled.div<{ $visible: boolean }>`
  background: ${(props) => props.theme.primary || "#f59e0b"};
  color: white;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  margin-top: 8px;
  display: ${props => props.$visible ? 'block' : 'none'};
  animation: slideIn 0.3s ease-out;
  word-wrap: break-word;
  white-space: normal;
  line-height: 1.3;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(4px);
  max-width: 100%;
  
  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

const MainText = styled.div`
  font-size: 11px;
  font-family: "JetBrains Mono", monospace;
  font-weight: 600;
`;

const SubText = styled.div`
  font-size: 10px;
  font-family: "JetBrains Mono", monospace;
  opacity: 0.9;
  margin-top: 3px;
`;

const StatusText = styled.div<{ $loading?: boolean }>`
  color: ${props => props.$loading ? (props.theme.primary || "#93c5fd") : (props.theme.textSecondary || "#9ca3af")};
  font-size: 10px;
  font-family: "JetBrains Mono", monospace;
  margin-top: 8px;
  font-weight: 500;
  letter-spacing: 0.05em;
`;

const ErrorText = styled.div`
  color: ${(props) => props.theme.danger || "#f87171"};
  font-size: 10px;
  font-family: "JetBrains Mono", monospace;
  margin-top: 6px;
  padding: 4px 6px;
  background: rgba(248, 113, 113, 0.1);
  border-radius: 4px;
  border: 1px solid rgba(248, 113, 113, 0.2);
`;

export const MapEndpointsHUD: React.FC<MapEndpointsHUDProps> = ({
  truncated,
  totalFound,
  currentCount,
  towersLoading,
  towersError
}) => {
  return (
    <HUDContainer>
      <TowerCountRow>
        <span>Towers in view:</span>
        <span>{currentCount.toLocaleString()}</span>
      </TowerCountRow>

      {truncated && totalFound && (
        <Notification $visible={truncated}>
          <MainText>
            📍 {currentCount.toLocaleString()} of {totalFound.toLocaleString()} towers
          </MainText>
          <SubText>Zoom in to see more</SubText>
        </Notification>
      )}

      <StatusText $loading={towersLoading}>
        {towersLoading ? "SYNCING..." : "LIVE"}
      </StatusText>

      {towersError && <ErrorText>{towersError}</ErrorText>}
    </HUDContainer>
  );
};
