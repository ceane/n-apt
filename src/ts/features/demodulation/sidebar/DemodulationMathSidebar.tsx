import React from "react";
import styled from "styled-components";
import { DecryptionFallback } from "@n-apt/ui/DecryptionFallback";
import { Collapsible } from "@n-apt/ui/Collapsible";

const Section = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  margin-bottom: 0;
  box-sizing: border-box;
  width: 100%;
`;

const MathFallback = styled.div`
  opacity: 0.5;
  font-size: 10px;
  text-align: center;
  color: ${(props) => props.theme.textSecondary};
`;

const loadDemodMath = async () => {
  try {
    const modulePath =
      "/" +
      [
        "@n-apt",
        "encrypted-modules",
        "tmp",
        "ts",
        "components",
        "math",
        "DemodMath",
      ].join("/");

    return await import(/* @vite-ignore */ modulePath + "?v=" + Date.now());
  } catch {
    return {
      default: () => (
        <DecryptionFallback moduleName="Demod Math" errorType="demod" />
      ),
    };
  }
};

const DemodMath = React.lazy(async () => {
  return loadDemodMath();
});

export const DemodulationMathSidebar: React.FC = () => {
  return (
    <Section>
      <Collapsible title="Demodulation Math" defaultOpen={false}>
        <React.Suspense fallback={<MathFallback>Loading Math…</MathFallback>}>
          <DemodMath />
        </React.Suspense>
      </Collapsible>
    </Section>
  );
};

export default DemodulationMathSidebar;
