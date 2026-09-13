import type { PreferencesSidebarSection } from "@n-apt/settings/sidebar/SettingsSidebar";

export const PREFERENCES_SECTIONS: PreferencesSidebarSection[] = [
  { id: "theme", label: "Theme" },
  { id: "sdr", label: "SDR Settings" },
  { id: "login", label: "Login" },
  { id: "iq-capture", label: "I/Q Capture Settings" },
  { id: "snapshot", label: "Snapshot & Fast Snapshot" },
  { id: "extras", label: "Extras" },
];
