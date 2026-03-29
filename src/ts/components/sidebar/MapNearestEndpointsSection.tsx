import React from "react";
import { Radio } from "lucide-react";
import { Collapsible } from "@n-apt/components/ui";
import { EndpointsListAndSearch } from "@n-apt/components/sidebar/EndpointsListAndSearch";

export const MapNearestEndpointsSection: React.FC = () => {
  return (
    <Collapsible
      icon={<Radio size={14} />}
      label="Nearest Endpoints /"
      defaultOpen={false}
    >
      <EndpointsListAndSearch />
    </Collapsible>
  );
};
