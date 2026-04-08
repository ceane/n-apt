import styled from 'styled-components';

export const FlowContainer = styled.div`
  width: 100%;
  height: 100%;
  background-color: ${(props) => props.theme.background};
  border: 1px solid ${(props) => props.theme.border};
  overflow: hidden;
  position: relative;
  z-index: 1;
  isolation: isolate;
  flex: 1;
`;
