import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "src/ts",
  buildDirectory: "build/react-router",
  ssr: false,
  routeDiscovery: {
    // React Router 8.3.0 rejects lazy discovery in SPA mode (ssr:false).
    // Keep the SPA build safe while route-module code splitting is adopted;
    // switch to "lazy" with an SSR-capable runtime in a later deployment
    // milestone.
    mode: "initial",
    manifestPath: "/__manifest",
  },
} satisfies Config;
