import React from "react";
import { MainLayout } from "@n-apt/components/MainLayout";

import { useLadleContext, useLink } from "@ladle/react";
import { useLocation } from "react-router-dom";

interface LadleAppShellProps {
  children: React.ReactNode;
  route?: string;
  title?: string;
}

// Helpers: stable scope, no React hooks inside
const routeToTab = (route: string) => {
  if (route.includes("draw")) return "draw";
  if (route.includes("demod")) return "analysis";
  if (route.includes("3d-model")) return "3d-model";
  if (route.includes("map")) return "map-endpoints";
  return "visualizer";
};

const tabToStory = (tab: string) => {
  if (tab.includes("draw")) return "routes-routes--draw-signal-route";
  if (tab.includes("demod")) return "routes-routes--demodulate-route";
  if (tab.includes("3d-model")) return "routes-routes--model3-droute";
  if (tab.includes("map")) return "routes-routes--map-endpoints-route";
  if (tab.includes("stitch")) return "routes-routes--stitch-test-route";
  return "routes-routes--visualizer-route";
};

const isKnownStoryId = (storyId: string) => {
  return [
    "routes-routes--draw-signal-route",
    "routes-routes--demodulate-route",
    "routes-routes--model3-droute",
    "routes-routes--map-endpoints-route",
    "routes-routes--stitch-test-route",
    "routes-routes--visualizer-route",
  ].includes(storyId);
};

const LocationSync: React.FC = () => {
  const location = useLocation();
  const linkTo = useLink();
  const { globalState } = useLadleContext();

  React.useEffect(() => {
    const targetStory = tabToStory(location.pathname);
    if (isKnownStoryId(targetStory) && globalState.story !== targetStory) {
      linkTo(targetStory);
    }
  }, [location.pathname, linkTo, globalState.story]);

  return null;
};

const SidebarShell: React.FC<{ activeTab: string }> = ({ activeTab }) => {
  // Lightweight shell to cooperate with MainLayout
  return (
    <div
      style={{
        width: 320,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid #333",
        padding: 12,
        boxSizing: "border-box",
        backgroundColor: "#111",
        color: "#eaeaea",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Ladle Sidebar</div>
      <div style={{ fontSize: 12, color: "#aaa" }}>Active tab: {activeTab}</div>
      <div style={{ height: 1, background: "#333", margin: "12px 0" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 12, color: "#bbb" }}>Tabs</div>
        <div>visualizer</div>
        <div>demodulate</div>
        <div>draw-signal</div>
        <div>map-endpoints</div>
      </div>
    </div>
  );
};

const ContentPanel: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <div
    style={{
      height: "100%",
      overflow: "auto",
      padding: "32px",
      backgroundColor: "#0a0a0a",
      color: "#e0e0e0",
      fontFamily: "JetBrains Mono, monospace",
      boxSizing: "border-box",
    }}
  >
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        minHeight: "100%",
      }}
    >
      <div>
        <div style={{ fontSize: "24px", color: "#00d4ff", marginBottom: "8px" }}>{title}</div>
        <div style={{ fontSize: "13px", color: "#777" }}>
          Ladle story rendered inside the real app shell.
        </div>
      </div>
      {children}
    </div>
  </div>
);

export const LadleAppShell = ({ children, route, title = "N-APT Shell" }: LadleAppShellProps) => {
  const { globalState } = useLadleContext();
  const storyId = globalState.story || "";

  const [isSidebarOpen, setIsSidebarOpen] = React.useState(() => {
    const saved = localStorage.getItem("n-apt-sidebar-open");
    return saved === null ? true : saved === "true";
  });

  const handleSidebarChange = (open: boolean) => {
    setIsSidebarOpen(open);
    localStorage.setItem("n-apt-sidebar-open", String(open));
  };

  // Use the provided route prop if present, otherwise infer from story ID
  const activeRoute = route || (
    storyId.includes("draw") ? "/draw-signal" :
      storyId.includes("demod") ? "/demodulate" :
        (storyId.includes("3d-model") || storyId.includes("human-model")) ? "/3d-model" :
          storyId.includes("map") ? "/map-endpoints" :
            "/visualizer"
  );

  return (
    <MainLayout
      sidebar={<SidebarShell activeTab={routeToTab(activeRoute)} />}
      isSidebarOpen={isSidebarOpen}
      onSidebarOpenChange={handleSidebarChange}
    >
      <LocationSync />
      <ContentPanel title={title}>{children}</ContentPanel>
    </MainLayout>
  );
};
