import React from "react";
import styled from "styled-components";

const PromptContent = styled.div`
  display: grid;
  gap: 16px;
`;

const PromptCopy = styled.div`
  display: grid;
  gap: 12px;
  color: ${({ theme }) => theme.textSecondary};
  line-height: 1.6;
`;

const PromptLinks = styled.div`
  display: grid;
  gap: 10px;
`;

const PromptLink = styled.a`
  color: ${({ theme }) => theme.primary};
  text-decoration: underline;
  text-underline-offset: 3px;
  transition:
    color 0.16s ease,
    opacity 0.16s ease;

  &:hover {
    color: ${({ theme }) => theme.primary};
    opacity: 0.85;
  }
`;

const SealRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 18px;
  flex-wrap: wrap;
  margin-top: 4px;
`;

const SealImage = styled.img`
  width: 168px;
  height: 168px;
  object-fit: contain;
  display: block;
  filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.18));
`;

export const TransmitPrompt: React.FC = () => {
  return (
    <PromptContent>
      <PromptCopy>
        <div>
          Some frequencies require an FCC license to transmit. It is your
          responsibility to verify authorization and comply with applicable FCC
          regulations before transmitting.
        </div>
        <div>
          Unauthorized transmission on licensed spectrum may violate FCC
          regulations (47 U.S.C. § 301). Verify frequency allocations, power
          limits, and licensing requirements before transmitting.
        </div>
      </PromptCopy>
      <PromptLinks>
        <PromptLink
          href="https://www.fcc.gov/obtaining-license"
          target="_blank"
          rel="noreferrer"
        >
          Obtaining A License
        </PromptLink>
        <PromptLink
          href="https://www.fcc.gov/media/radio/public-and-broadcasting"
          target="_blank"
          rel="noreferrer"
        >
          The Public And Broadcasting
        </PromptLink>
      </PromptLinks>
      <SealRow aria-label="Government seals">
        <SealImage src="/images/USFCC_seal.svg" alt="FCC seal" />
        <SealImage src="/images/USDOJ_seal.svg" alt="DOJ seal" />
      </SealRow>
    </PromptContent>
  );
};

export default TransmitPrompt;
