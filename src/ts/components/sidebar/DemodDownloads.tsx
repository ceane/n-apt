import React from "react";
import styled from "styled-components";
import { useDemod } from "@n-apt/contexts/DemodContext";
import { CaptureResult } from "@n-apt/consts/types";

const Section = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  margin-bottom: 0;
  box-sizing: border-box;
  
  /* Flash animation when scrolled to */
  &[data-flash="true"] {
    animation: flash 0.2s steps(2, start) 10 alternate;
  }
  
  @keyframes flash {
    to {
      background-color: rgba(0, 255, 136, 0.33);
    }
  }
  
  /* Fallback for browsers that don't support attribute selectors */
  &.flash {
    animation: flash 2s ease-in-out infinite alternate;
  }
`;

const SectionTitle = styled.div`
  font-size: 11px;
  color: ${(props) => props.theme.metadataLabel};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-top: 1rem;
  margin-bottom: 0;
  font-weight: 600;
  font-family: ${(props) => props.theme.typography.mono};
  grid-column: 1 / -1;
`;

const ResultCard = styled.div`
  padding: 8px;
  border-radius: 4px;
  margin-top: 4px;
`;

const ResultLabel = styled.div`
  font-size: 10px;
  color: ${(props) => props.theme.textSecondary};
  margin-bottom: 8px;
  font-family: ${(props) => props.theme.typography.mono};
`;

const DownloadCaptureLink = styled.button`
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: center;
  text-decoration: none;
  display: block;
`;

interface DemodDownloadsProps {
  className?: string;
}

export const DemodDownloads: React.FC<DemodDownloadsProps> = ({ className }) => {
  const { analysisSession } = useDemod();

  // Refs for scrolling and flashing
  const referenceCapturesRef = React.useRef<HTMLDivElement>(null);
  const [shouldFlash, setShouldFlash] = React.useState(false);
  const wasPreviouslyAnalyzing = React.useRef(false);

  // Handle flashing when analysis completes
  React.useEffect(() => {
    if (analysisSession.state === 'result' && wasPreviouslyAnalyzing.current) {
      // Reset the flag
      wasPreviouslyAnalyzing.current = false;

      // Trigger flash animation
      setShouldFlash(true);

      // Remove flash after animation completes
      setTimeout(() => {
        setShouldFlash(false);
      }, 2000); // Match animation duration
    } else if (analysisSession.state === 'capturing' || analysisSession.state === 'analyzing') {
      // Set flag when analysis starts
      wasPreviouslyAnalyzing.current = true;
      setShouldFlash(false);
    }
  }, [analysisSession.state]);

  if (analysisSession.state !== 'result' || !analysisSession.result?.naptFilePath) {
    return null;
  }

  return (
    <Section
      ref={referenceCapturesRef}
      data-sidebar-results
      data-flash={shouldFlash.toString()}
      className={`${shouldFlash ? 'flash' : ''} ${className || ''}`}
    >
      <SectionTitle>Reference Captures</SectionTitle>
      <ResultCard>
        <DownloadCaptureLink
          href={analysisSession.result.naptFilePath}
          download
          as="a"
        >
          {analysisSession.result.naptFilePath}
        </DownloadCaptureLink>
        {analysisSession.result.timestamp && (
          <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
            {new Date(analysisSession.result.timestamp).toLocaleString()}
          </div>
        )}
        {analysisSession.result.fileSize && (
          <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
            Size: {(analysisSession.result.fileSize / 1024 / 1024).toFixed(2)} MB
          </div>
        )}
      </ResultCard>
    </Section>
  );
};

export default DemodDownloads;
