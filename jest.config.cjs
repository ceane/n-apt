/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/test/ts/setup.ts"],
  extensionsToTreatAsEsm: [".ts", ".tsx"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^react-router-dom$": "<rootDir>/node_modules/react-router-dom/dist/index.js",
    "^@n-apt/fft/FFTCanvasRenderer$": "<rootDir>/src/fft/FFTCanvasRenderer.ts",
    "^@n-apt/waterfall/FIFOWaterfallRenderer$": "<rootDir>/src/waterfall/FIFOWaterfallRenderer.ts",
    "^@n-apt/consts$": "<rootDir>/src/consts",
    "^@n-apt/components/(.*)$": "<rootDir>/src/components/$1",
    "^@n-apt/fft/(.*)$": "<rootDir>/src/fft/$1.ts",
    "^@n-apt/waterfall/(.*)$": "<rootDir>/src/waterfall/$1.ts",
    "^@n-apt/hooks/(.*)$": "<rootDir>/src/hooks/$1",
    "^@n-apt/glb_models/(.*)$": "<rootDir>/src/glb_models/$1",
    "^@n-apt/(.*)$": "<rootDir>/src/$1",
  },
  testMatch: ["<rootDir>/test/ts/**/*.test.ts", "<rootDir>/test/ts/**/*.test.tsx"],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/main.tsx",
    "!src/vite-env.d.ts",
    "!src/workers/**/*", // Skip workers from coverage for now
  ],
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          jsx: "react-jsx",
        },
      },
    ],
  },
  transformIgnorePatterns: ["node_modules/(?!(.*\\.mjs$))"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
};
