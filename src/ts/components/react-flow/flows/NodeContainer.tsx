import styled from 'styled-components';

export const NodeContainer = styled.div`
  background-color: ${(props) => props.theme.surface}e6;
  backdrop-filter: blur(8px);
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 12px;
  padding: 16px;
  min-width: 200px;
  color: ${(props) => props.theme.textPrimary};
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  }
`;
