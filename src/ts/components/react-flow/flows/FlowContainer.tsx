import styled from "styled-components";

export const FlowContainer = styled.div`
  width: 100%;
  height: 100%;
  position: relative;
  background: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  isolation: isolate;
  z-index: 1;
  box-shadow: none;
`;
