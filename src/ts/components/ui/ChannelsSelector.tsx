import React from "react";
import styled from "styled-components";
import { Range } from "@n-apt/components/ui/Range";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  grid-column: 1 / -1;
  padding: 14px;
  box-sizing: border-box;
  background-color: ${(props) =>
    props.theme.mode === "light"
      ? props.theme.primaryAnchor
      : props.theme.surface};
  border-radius: 6px;
  border: 1px solid
    ${(props) =>
      props.theme.mode === "light"
        ? props.theme.borderHover
        : props.theme.border};
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: space-between;
  width: 100%;
  font-size: 12px;
  color: ${(props) => props.theme.textSecondary};
`;

const LabelWithIcon = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 10px;
  line-height: 1.2;

  svg {
    width: 14px;
    height: 14px;
    color: ${(props) => props.theme.textSecondary};
    opacity: 0.5;
  }
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  width: 100%;
  align-items: flex-start;
`;

const RangeGridExtras = styled.div`
  grid-column: 1 / -1;
  width: 100%;
  min-width: 0;
`;

export interface ChannelOption {
  label: string;
  min: number;
  max: number;
  extra?: React.ReactNode;
}

export interface ChannelsGridProps {
  channels: ChannelOption[];
  selectedLabels: string[];
  onChange: (labels: string[]) => void;
  rangeExtras?: React.ReactNode;
}

export const ChannelsGrid: React.FC<ChannelsGridProps> = ({
  channels,
  selectedLabels,
  onChange,
  rangeExtras,
}) => {
  return (
    <Grid>
      {rangeExtras && <RangeGridExtras>{rangeExtras}</RangeGridExtras>}
      {channels.map((channel, idx) => {
        const isSelected = selectedLabels.includes(channel.label);
        const rangeVariant = idx % 2 === 0 ? "primary" : "secondary";

        const handleToggle = () => {
          const nextLabels = isSelected
            ? selectedLabels.filter((l) => l !== channel.label)
            : [...selectedLabels, channel.label];
          onChange(nextLabels);
        };

        return (
          <Range
            key={channel.label}
            label={channel.label}
            min={channel.min}
            max={channel.max}
            selected={isSelected}
            onToggle={handleToggle}
            variant={rangeVariant}
          >
            {channel.extra}
          </Range>
        );
      })}
    </Grid>
  );
};

export interface ChannelsSelectorProps extends ChannelsGridProps {
  label: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  headerExtra?: React.ReactNode;
  className?: string;
}

export const ChannelsSelector: React.FC<ChannelsSelectorProps> = ({
  label,
  icon: Icon,
  headerExtra,
  channels,
  selectedLabels,
  onChange,
  rangeExtras,
  className,
}) => {
  return (
    <Container className={className}>
      <Header>
        <LabelWithIcon>
          {Icon && <Icon size={14} />}
          {label}
        </LabelWithIcon>
        {headerExtra}
      </Header>
      <ChannelsGrid
        channels={channels}
        selectedLabels={selectedLabels}
        onChange={onChange}
        rangeExtras={rangeExtras}
      />
    </Container>
  );
};

export default ChannelsSelector;
