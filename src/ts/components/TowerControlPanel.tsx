import React from 'react';
import styled from 'styled-components';

interface TowerControlPanelProps {
  truncated: boolean;
  totalFound: number | null;
  currentCount: number;
  towersLoading: boolean;
  towersError: string | null;
}

const TowersContainer = styled.div`
  width: 240px;
`;

const TowerCountRow = styled.div`
  display: flex;
  justify-content: space-between;
`;

const Notification = styled.div<{ $visible: boolean }>`
  background: #f59e0b;
  color: white;
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  margin-top: 6px;
  display: ${props => props.$visible ? 'block' : 'none'};
  animation: slideIn 0.3s ease-out;
  word-wrap: break-word;
  white-space: normal;
  line-height: 1.3;
  
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
`;

const SubText = styled.div`
  font-size: 10px;
  opacity: 0.9;
  margin-top: 2px;
`;

const StatusText = styled.div<{ $loading?: boolean }>`
  color: ${props => props.$loading ? "#93c5fd" : "#9ca3af"};
  font-size: 10px;
  margin-top: 8px;
`;

const ErrorText = styled.div`
  color: #f87171;
  font-size: 10px;
`;

export const TowerControlPanel: React.FC<TowerControlPanelProps> = ({
  truncated,
  totalFound,
  currentCount,
  towersLoading,
  towersError
}) => {
  return (
    <TowersContainer>
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
    </TowersContainer>
  );
};
