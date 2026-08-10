import React from "react";
import styled from "styled-components";
import { useDemodAnalysis } from "@n-apt/demodulation/public/context/DemodAnalysisContext";
import { useAuthentication } from "@n-apt/app/hooks/useAuthentication";
import { buildSafeDownloadUrl } from "@n-apt/ui/downloadUrl";

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
  font-size: ${({ theme }) => theme.typography.codeSize};
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

export const DemodDownloads: React.FC<DemodDownloadsProps> = ({
  className,
}) => {
  const { analysisSession } = useDemodAnalysis();
  const { sessionToken } = useAuthentication();

  // Refs for scrolling and flashing
  const referenceCapturesRef = React.useRef<HTMLDivElement>(null);
  const [shouldFlash, setShouldFlash] = React.useState(false);
  const wasPreviouslyAnalyzing = React.useRef(false);

  // Handle flashing when analysis completes
  React.useEffect(() => {
    let id: ReturnType<typeof setTimeout> | undefined;
    if (analysisSession.state === "result" && wasPreviouslyAnalyzing.current) {
      wasPreviouslyAnalyzing.current = false;
      setShouldFlash(true);
      id = setTimeout(() => {
        setShouldFlash(false);
      }, 2000);
    } else if (
      analysisSession.state === "capturing" ||
      analysisSession.state === "analyzing"
    ) {
      wasPreviouslyAnalyzing.current = true;
      setShouldFlash(false);
    }
    return () => clearTimeout(id);
  }, [analysisSession.state]);

  if (
    analysisSession.state !== "result" ||
    !analysisSession.result?.naptFilePath
  ) {
    return null;
  }

  return (
    <Section
      ref={referenceCapturesRef}
      data-sidebar-results
      data-flash={shouldFlash.toString()}
      className={`${shouldFlash ? "flash" : ""} ${className || ""}`}
    >
      <SectionTitle>Reference Captures</SectionTitle>
      <ResultCard>
        <DownloadCaptureLink
          href={buildSafeDownloadUrl(
            analysisSession.result.naptFilePath,
            sessionToken,
          )}
          download
          as="a"
        >
          {analysisSession.result.naptFilePath}
        </DownloadCaptureLink>
        {analysisSession.result.timestamp && (
          <div style={{ fontSize: "10px", color: "#666", marginTop: "4px" }}>
            {new Date(analysisSession.result.timestamp).toLocaleString()}
          </div>
        )}
        {analysisSession.result.fileSize && (
          <div style={{ fontSize: "10px", color: "#666", marginTop: "2px" }}>
            Size: {(analysisSession.result.fileSize / 1024 / 1024).toFixed(2)}{" "}
            MB
          </div>
        )}
      </ResultCard>
    </Section>
  );
};

export default DemodDownloads;
