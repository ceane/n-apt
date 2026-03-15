/**
 * Utility for mapping Mobile Country Codes (MCC) and Mobile Network Codes (MNC)
 * to human-readable carrier names.
 * Data sourced from ITU Operational Bulletins and community-maintained lists.
 */

const CARRIER_MAP: Record<string, string> = {
  // --- US Carriers ---
  "310-260": "T-Mobile US",
  "310-120": "Sprint (T-Mobile US)",
  "311-490": "T-Mobile US",
  "310-410": "AT&T Mobility",
  "310-150": "AT&T Mobility",
  "310-280": "AT&T Mobility",
  "311-180": "AT&T Mobility",
  "311-480": "Verizon Wireless",
  "310-012": "Verizon Wireless",
  "310-004": "Verizon Wireless",
  "311-580": "US Cellular",
  "311-230": "C Spire Wireless",
  "313-340": "Dish Wireless",
  "310-240": "Aeris",
  "310-830": "Cap Rock Telephone",
  "311-110": "High Plains Wireless",
  "311-730": "Metropcs",

  // --- International (Common in Global Data) ---
  "234-10": "O2 (UK)",
  "234-15": "Vodafone (UK)",
  "234-20": "Three (UK)",
  "234-30": "EE (UK)",
  "208-01": "Orange (France)",
  "208-10": "SFR (France)",
  "262-01": "Telekom (Germany)",
  "262-02": "Vodafone (Germany)",
  "262-03": "O2 (Germany)",
};

/**
 * Returns the carrier name for a given MCC and MNC.
 * Falls back to "Unknown Carrier (MCC-MNC)" if not found.
 */
export function getCarrierName(mcc: string, mnc: string): string {
  const key = `${mcc}-${mnc}`;
  return CARRIER_MAP[key] || `Unknown Carrier (${key})`;
}

/**
 * Common tower leasees/infrastructure providers based on location
 * (Mock logic for now as this data isn't in OpenCellID directly)
 */
export function getPotentialLeasee(towerId: string): string {
  // This is a placeholder for future matching logic
  const providers = ["American Tower", "Crown Castle", "SBA Communications", "Vertical Bridge"];
  const index = parseInt(towerId.slice(-1), 16) % providers.length;
  return providers[index];
}
