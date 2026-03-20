import type { UserConfig } from "@ladle/react";
import { ThemeState } from "@ladle/react";

const config: UserConfig = {
  stories: "../src/ts/{components,routes}/**/*.stories.@(js|jsx|ts|tsx)",
  addons: {
    theme: {
      defaultState: ThemeState.Dark,
    },
  },
  viteConfig: "./ladle.vite.config.ts",
};

export default config;
