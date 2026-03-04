import { useCallback } from "react";

interface UseChannelManagementProps {
  allChannelsRef: React.MutableRefObject<any[]>;
  setActiveChannel: (channel: number) => void;
  setFrequencyRange: (range: { min: number; max: number }) => void;
}

export const useChannelManagement = ({
  allChannelsRef,
  setActiveChannel,
  setFrequencyRange,
}: UseChannelManagementProps) => {
  // Channel switching helper - batches state updates for better performance
  const switchChannel = useCallback((newIdx: number) => {
    const ch = allChannelsRef.current[newIdx];
    if (!ch) return;
    
    const span = (ch.sample_rate_hz || 3200000) / 1_000_000;
    const center = (ch.center_freq_hz || 0) / 1_000_000;
    
    setActiveChannel(newIdx);
    setFrequencyRange({ min: center - span / 2, max: center + span / 2 });
  }, [setActiveChannel, setFrequencyRange]);

  return { switchChannel };
};
