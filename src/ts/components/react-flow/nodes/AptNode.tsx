import React from "react";
import { SignalPreviewNode } from "./SignalPreviewNode";
import { generateAPTIQData } from "@n-apt/utils/generateSignalData";
import { useAppDispatch } from "@n-apt/redux";
import { setBandwidth } from "@n-apt/redux/slices/demodSlice";

interface AptNodeProps {
  data: {
    label: string;
  };
}

export const AptNode: React.FC<AptNodeProps> = ({ data }) => {
  const dispatch = useAppDispatch();
  
  React.useEffect(() => {
    dispatch(setBandwidth(200));
  }, [dispatch]);

  return (
    <SignalPreviewNode
      label={data.label || "APT Analysis"}
      activeSignalArea="apt-preview"
      centerFrequencyHz={137_920_000}
      frequencyRange={{ min: 137_820_000, max: 138_020_000 }}
      demodulationRangeHz={200_000}
      buildIqData={generateAPTIQData}
    />
  );
};
